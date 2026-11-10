package com.nilspath.api;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.*;
import org.springframework.transaction.annotation.Transactional;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:regressions;DB_CLOSE_DELAY=-1","spring.datasource.username=sa",
    "spring.datasource.password=","spring.datasource.driver-class-name=org.h2.Driver","spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
    "spring.jpa.hibernate.ddl-auto=create-drop","app.admin.username=","app.admin.password="})
@AutoConfigureMockMvc @Transactional
class ApiRegressionTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired Accounts accounts;
    @Autowired Jobs jobs;
    @Autowired Applications applications;
    @Autowired Interviews interviews;
    @Autowired Companies companies;
    @Autowired PasswordEncoder encoder;
    Account candidate,hr,otherHr,admin;
    Job job;
    ApplicationRecord application;
    private static final String PASSWORD="Regression@2026!";

    @BeforeEach void fixtures() {
        String suffix=UUID.randomUUID().toString();
        candidate=accounts.save(new Account("candidate-"+suffix,encoder.encode(PASSWORD),"CANDIDATE",true,"Candidate"));
        hr=accounts.save(new Account("hr-"+suffix,encoder.encode(PASSWORD),"HR",true,"HR"));
        otherHr=accounts.save(new Account("other-"+suffix,encoder.encode(PASSWORD),"HR",true,"Other HR"));
        admin=accounts.save(new Account("admin-"+suffix,encoder.encode(PASSWORD),"ADMIN",true,"Admin"));
        job=jobs.save(new Job("Regression developer","Regression Co","Pune","Full Time","java,sql,react",0,hr.id));
        application=applications.save(new ApplicationRecord(job.id,candidate.id));
    }
    String basic(Account account) { return scoped(account.role,account.username,PASSWORD); }
    String scoped(String role,String username,String password) {
        return "Basic "+Base64.getEncoder().encodeToString((role+"/"+username+":"+password).getBytes(StandardCharsets.UTF_8));
    }
    ResultActions postJson(String path,Object body,Account account) throws Exception {
        var request=post(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body));
        if(account!=null)request.header("Authorization",basic(account));
        return mvc.perform(request);
    }
    JsonNode data(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }

    @Test void malformedIdsAndMissingResumeFilesReturnJsonValidationErrors() throws Exception {
        mvc.perform(post("/api/candidate/jobs/not-a-number/apply").header("Authorization",basic(candidate)))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Missing or invalid request data."));
        mvc.perform(multipart("/api/candidate/resume/upload").header("Authorization",basic(candidate)))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Missing or invalid request data."));
    }

    @Test void hostingRoutesArePublicButApiDataRemainsProtected() throws Exception {
        mvc.perform(get("/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
        for(String path:List.of("/candidate/login","/candidate/register","/hr/login","/hr/register","/admin","/admin/login"))
            mvc.perform(get(path)).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        for(String path:List.of("/api/admin/accounts","/api/hr/jobs","/api/candidate/applications"))
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
    }

    @Test void sameUsernameWithThreeDifferentPasswordsOnlyOpensItsOwnWorkspace() throws Exception {
        String username="three-roles-"+UUID.randomUUID();
        var passwords=Map.of("CANDIDATE","CandidateOnly@2026!","HR","HrOnly@2026!","ADMIN","AdminOnly@2026!");
        passwords.forEach((role,password)->accounts.save(new Account(username,encoder.encode(password),role,true,role)));
        for(String portal:passwords.keySet()) for(String passwordRole:passwords.keySet()) {
            var result=postJson("/api/auth/login",Map.of("username",username,"password",passwords.get(passwordRole),"role",portal),null);
            if(portal.equals(passwordRole)) result.andExpect(status().isOk()).andExpect(jsonPath("$.role").value(portal));
            else result.andExpect(status().isUnauthorized());
            mvc.perform(get("/api/auth/me").header("Authorization",scoped(portal,username,passwords.get(passwordRole))))
                .andExpect(portal.equals(passwordRole)?status().isOk():status().isUnauthorized());
        }
    }

    @Test void allRolesRequireExplicitWorkspaceAndCredentialsOnEveryRequest() throws Exception {
        for(Account account:List.of(candidate,hr,admin)) {
            String unqualified="Basic "+Base64.getEncoder().encodeToString((account.username+":"+PASSWORD).getBytes(StandardCharsets.UTF_8));
            mvc.perform(get("/api/auth/me").header("Authorization",unqualified)).andExpect(status().isUnauthorized());
            var response=mvc.perform(get("/api/auth/me").header("Authorization",basic(account)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value(account.role)).andReturn();
            assertNull(response.getRequest().getSession(false));
            mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        }
    }

    @Test void registeringHrDoesNotCreateACandidateOrReserveTheCandidateUsername() throws Exception {
        String username="shared-"+UUID.randomUUID();
        long candidatesBefore=accounts.findByRole("CANDIDATE").size();
        postJson("/api/auth/register",Map.of("username",username,"password",PASSWORD,"fullName","Recruiter","role","HR"),null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("HR")).andExpect(jsonPath("$.approved").value(false));
        assertEquals(candidatesBefore,accounts.findByRole("CANDIDATE").size());
        assertTrue(accounts.findByUsernameAndRole(username,"CANDIDATE").isEmpty());
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("HR",username,PASSWORD))).andExpect(status().isUnauthorized());
        postJson("/api/auth/register",Map.of("username",username,"password",PASSWORD,"fullName","Candidate","role","CANDIDATE"),null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("CANDIDATE")).andExpect(jsonPath("$.approved").value(true));
        assertEquals(2,accounts.findAllByUsername(username).size());
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("CANDIDATE",username,PASSWORD)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("CANDIDATE"));
        assertFalse(accounts.findByUsernameAndRole(username,"HR").orElseThrow().approved);
    }

    @Test void identicalUsernamesAndPasswordsStayIsolatedByPortalAndApproval() throws Exception {
        String username=candidate.username;
        var recruiter=data(postJson("/api/auth/register",Map.of("username",username,"password",PASSWORD,"fullName","Shared-name HR","role","HR"),null)
            .andExpect(status().isOk()).andReturn());
        long recruiterId=recruiter.get("id").asLong();
        mvc.perform(put("/api/admin/hr/"+recruiterId+"/approve").header("Authorization",basic(admin))).andExpect(status().isOk());
        String candidateToken=scoped("CANDIDATE",username,PASSWORD),hrToken=scoped("HR",username,PASSWORD);
        mvc.perform(get("/api/auth/me").header("Authorization",candidateToken)).andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(candidate.id.intValue())).andExpect(jsonPath("$.username").value(username)).andExpect(jsonPath("$.role").value("CANDIDATE"));
        mvc.perform(get("/api/auth/me").header("Authorization",hrToken)).andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(recruiterId)).andExpect(jsonPath("$.role").value("HR"));
        mvc.perform(get("/api/hr/jobs").header("Authorization",candidateToken)).andExpect(status().isForbidden());
        mvc.perform(get("/api/candidate/applications").header("Authorization",hrToken)).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/accounts").header("Authorization",hrToken)).andExpect(status().isForbidden());
        mvc.perform(get("/api/auth/me").header("Authorization","Basic "+Base64.getEncoder().encodeToString((username+":"+PASSWORD).getBytes(StandardCharsets.UTF_8)))).andExpect(status().isUnauthorized());
        for(String role:List.of("CANDIDATE","HR"))
            postJson("/api/auth/register",Map.of("username",username,"password",PASSWORD,"fullName","Duplicate","role",role),null)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("already exists in the")));
    }

    @Test void sharedUsernamesCannotUseAnotherRolesPasswordOrGainAdminAccess() throws Exception {
        String username=admin.username,password="CandidateOnly@2026!";
        postJson("/api/auth/register",Map.of("username",username,"password",password,"fullName","Separate candidate","role","CANDIDATE"),null)
            .andExpect(status().isOk());
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("ADMIN",username,PASSWORD)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("ADMIN"));
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("CANDIDATE",username,password)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("CANDIDATE"));
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("CANDIDATE",username,PASSWORD))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("ADMIN",username,password))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/accounts").header("Authorization",scoped("CANDIDATE",username,password))).andExpect(status().isForbidden());
        postJson("/api/auth/register",Map.of("username",username,"password",password,"fullName","Invalid admin","role","ADMIN"),null)
            .andExpect(status().isBadRequest());
    }

    @Test void portalLoginExplainsPendingHrOnlyAfterVerifyingItsPassword() throws Exception {
        String username=candidate.username;
        var recruiter=data(postJson("/api/auth/register",Map.of("username",username,"password",PASSWORD,"fullName","Pending HR","role","HR"),null)
            .andExpect(status().isOk()).andReturn());
        postJson("/api/auth/login",Map.of("username",username,"password",PASSWORD,"role","HR"),null)
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("HR_APPROVAL_PENDING"))
            .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("awaiting Admin approval")));
        postJson("/api/auth/login",Map.of("username",username,"password","WrongPassword@123","role","HR"),null)
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        postJson("/api/auth/login",Map.of("username",username,"password",PASSWORD,"role","CANDIDATE"),null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(candidate.id.intValue()));
        assertFalse(accounts.findByUsernameAndRole(username,"HR").orElseThrow().approved);
        mvc.perform(put("/api/admin/hr/"+recruiter.get("id").asLong()+"/approve").header("Authorization",basic(admin))).andExpect(status().isOk());
        postJson("/api/auth/login",Map.of("username",username,"password",PASSWORD,"role","HR"),null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("HR"));
    }

    @Test void portalLoginKeepsAllThreeSharedNamesSeparateAndDoesNotCreateAccounts() throws Exception {
        String username=admin.username;
        Account sharedCandidate=accounts.saveAndFlush(new Account(username,encoder.encode(PASSWORD),"CANDIDATE",true,"Separate Candidate"));
        Account sharedHr=accounts.saveAndFlush(new Account(username,encoder.encode(PASSWORD),"HR",true,"Separate HR"));
        long count=accounts.count();
        for(Account expected:List.of(admin,sharedCandidate,sharedHr))
            postJson("/api/auth/login",Map.of("username"," "+username+" ","password",PASSWORD,"role",expected.role),null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value(expected.role))
                .andExpect(jsonPath("$.id").value(expected.id.intValue())).andExpect(jsonPath("$.username").value(username));
        assertEquals(count,accounts.count());
        postJson("/api/auth/login",Map.of("username",username,"password","WrongPassword@123","role","ADMIN"),null)
            .andExpect(status().isUnauthorized());
        postJson("/api/auth/login",Map.of("username","not-registered","password",PASSWORD,"role","HR"),null)
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test void portalLoginValidatesRequiredInputAndRole() throws Exception {
        postJson("/api/auth/login",Map.of("username",candidate.username,"password",PASSWORD),null).andExpect(status().isBadRequest());
        postJson("/api/auth/login",Map.of("username",candidate.username,"password",PASSWORD,"role","OTHER"),null).andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("null"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").exists());
    }

    @Test void namesAndUsernamesAreDistinctAndUsernamesAreCaseInsensitiveWithinEachRole() throws Exception {
        String upper=candidate.username.toUpperCase(Locale.ROOT);
        postJson("/api/auth/login",Map.of("username",upper,"password",PASSWORD,"role","CANDIDATE"),null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(candidate.id.intValue()));
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("CANDIDATE",upper,PASSWORD)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.username").value(candidate.username));
        postJson("/api/auth/register",Map.of("username",upper,"password",PASSWORD,"fullName","Other display name","role","CANDIDATE"),null)
            .andExpect(status().isConflict());
        postJson("/api/auth/login",Map.of("username",candidate.fullName,"password",PASSWORD,"role","CANDIDATE"),null)
            .andExpect(status().isUnauthorized());
        postJson("/api/auth/register",Map.of("username",upper,"password",PASSWORD,"confirmPassword",PASSWORD,"fullName","  Separate Recruiter  ","role","HR"),null)
            .andExpect(status().isOk()).andExpect(jsonPath("$.fullName").value("Separate Recruiter"));
        postJson("/api/auth/login",Map.of("username",candidate.username,"password",PASSWORD,"role","HR"),null)
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("HR_APPROVAL_PENDING"));
    }

    @Test void registrationRejectsMismatchedConfirmationAndOversizedPasswords() throws Exception {
        String username="confirmation-"+UUID.randomUUID();
        postJson("/api/auth/register",Map.of("username",username,"password",PASSWORD,"confirmPassword","DifferentPassword@123","fullName","New Candidate","role","CANDIDATE"),null)
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Passwords do not match"));
        assertTrue(accounts.findAllByUsername(username).isEmpty());
        String longPassword="界".repeat(25);
        postJson("/api/auth/register",Map.of("username",username,"password",longPassword,"confirmPassword",longPassword,"fullName","New Candidate","role","CANDIDATE"),null)
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("too long")));
        assertTrue(accounts.findAllByUsername(username).isEmpty());
    }

    @Test void loginRejectsPasswordsBeyondBcryptByteLimit() throws Exception {
        String username="byte-limit-"+UUID.randomUUID(),password="界".repeat(24);
        postJson("/api/auth/register",Map.of("username",username,"password",password,"fullName","Byte Limit","role","CANDIDATE"),null)
            .andExpect(status().isOk());
        postJson("/api/auth/login",Map.of("username",username,"password",password,"role","CANDIDATE"),null)
            .andExpect(status().isOk());
        postJson("/api/auth/login",Map.of("username",username,"password",password+"x","role","CANDIDATE"),null)
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("too long")));
        mvc.perform(get("/api/auth/me").header("Authorization",scoped("CANDIDATE",username,password+"x")))
            .andExpect(status().isUnauthorized());
    }

    @Test void passwordSpacesAndCapitalizationArePreservedExactly() throws Exception {
        String username="exact-"+UUID.randomUUID(),password=" Exact:Password@123 ";
        postJson("/api/auth/register",Map.of("username",username,"password",password,"confirmPassword",password,"fullName","Display Name","role","CANDIDATE"),null)
            .andExpect(status().isOk());
        postJson("/api/auth/login",Map.of("username",username,"password",password,"role","CANDIDATE"),null).andExpect(status().isOk());
        postJson("/api/auth/login",Map.of("username",username,"password",password.trim(),"role","CANDIDATE"),null).andExpect(status().isUnauthorized());
        postJson("/api/auth/login",Map.of("username",username,"password",password.toLowerCase(Locale.ROOT),"role","CANDIDATE"),null).andExpect(status().isUnauthorized());
    }

    @Test void missingNullAndMalformedInputsReturnValidationErrors() throws Exception {
        postJson("/api/auth/register",Map.of("username","new-user","fullName","New User","role","CANDIDATE"),null).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").exists());
        for(String path:List.of("/api/candidate/analyze","/api/candidate/resume/match-text")) {
            for(String body:List.of("{}","{\"resume\":null}","{\"resume\":\" \"}","null","{"))
                mvc.perform(post(path).header("Authorization",basic(candidate)).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").exists());
        }
        mvc.perform(put("/api/hr/applications/"+application.id+"/status").header("Authorization",basic(hr)).contentType(MediaType.APPLICATION_JSON).content("{\"status\":null}"))
            .andExpect(status().isBadRequest());
        postJson("/api/hr/jobs",Map.of("title","Developer","company","Company","city","Pune","type","Full Time","distanceKm",-1),hr).andExpect(status().isBadRequest());
    }
    @Test void textLegacyAndDocxUseIdenticalScores() throws Exception {
        String resume="Java. React.js and SQL.";
        var legacy=data(postJson("/api/candidate/analyze",Map.of("resume",resume),candidate).andExpect(status().isOk()).andReturn());
        var text=data(postJson("/api/candidate/resume/match-text",Map.of("resume",resume),candidate).andExpect(status().isOk()).andReturn()).get("matches");
        assertEquals(legacy,text);
        byte[] bytes;
        try(var doc=new XWPFDocument();var output=new ByteArrayOutputStream()) {
            doc.createParagraph().createRun().setText(resume);doc.write(output);bytes=output.toByteArray();
        }
        var file=new MockMultipartFile("file","resume.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",bytes);
        var upload=data(mvc.perform(multipart("/api/candidate/resume/upload").file(file).header("Authorization",basic(candidate))).andExpect(status().isOk()).andReturn());
        assertEquals(text,upload.get("matches"));
    }
    @Test void hrScreeningIsRestrictedToOwnedJobs() throws Exception {
        var own=data(postJson("/api/hr/resume/match-text",Map.of("resume","java"),hr).andExpect(status().isOk()).andReturn()).get("matches");
        assertEquals(1,own.size());assertEquals(job.id.longValue(),own.get(0).get("jobId").asLong());
        postJson("/api/hr/resume/match-text",Map.of("resume","java"),otherHr).andExpect(jsonPath("$.matches").isEmpty());
        postJson("/api/hr/resume/match-text",Map.of("resume","java"),candidate).andExpect(status().isForbidden());
    }
    @Test void schedulingRejectsInvalidPastAndOtherOwnersAndShowsValidInterviews() throws Exception {
        String path="/api/hr/applications/"+application.id+"/interviews";
        for(String date:List.of("garbage","2026-02-30T12:00:00Z","2020-01-01T12:00:00Z","2099-01-01T12:00:00"))
            postJson(path,Map.of("scheduledAt",date),hr).andExpect(status().isBadRequest());
        assertEquals("APPLIED",applications.findById(application.id).orElseThrow().status);
        assertTrue(interviews.findByApplicationId(application.id).isEmpty());
        var valid=Map.of("scheduledAt",OffsetDateTime.now().plusDays(1).toString(),"notes","Bring project examples");
        postJson(path,valid,otherHr).andExpect(status().isNotFound());
        postJson(path,valid,hr).andExpect(status().isOk());
        assertEquals("INTERVIEW",applications.findById(application.id).orElseThrow().status);
        mvc.perform(get("/api/candidate/applications").header("Authorization",basic(candidate)))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].interviews[0].notes").value("Bring project examples"));
    }
    @Test void companiesSupportCrudAndRenameJobListings() throws Exception {
        var created=data(postJson("/api/admin/companies",Map.of("name","New Regression Co","city","Pune","website","https://example.com"),admin).andExpect(status().isOk()).andReturn());
        long id=created.get("id").asLong();
        mvc.perform(put("/api/admin/companies/"+id).header("Authorization",basic(admin)).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Renamed Co\",\"city\":\"Mumbai\",\"website\":\"\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Renamed Co"));
        mvc.perform(delete("/api/admin/companies/"+id).header("Authorization",basic(admin))).andExpect(status().isNoContent());
        postJson("/api/admin/companies",Map.of("name","Regression Co"),admin).andExpect(status().isOk());
        var companies=data(mvc.perform(get("/api/admin/companies").header("Authorization",basic(admin))).andReturn());
        long existingId=0;
        for(JsonNode c:companies) if(c.get("name").asText().equals("Regression Co"))existingId=c.get("id").asLong();
        assertNotEquals(0,existingId);
        mvc.perform(put("/api/admin/companies/"+existingId).header("Authorization",basic(admin)).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Updated Regression Co\"}"))
            .andExpect(status().isOk());
        assertEquals("Updated Regression Co",jobs.findById(job.id).orElseThrow().company);
        mvc.perform(delete("/api/admin/companies/"+existingId).header("Authorization",basic(admin))).andExpect(status().isConflict());
        mvc.perform(get("/api/admin/companies").header("Authorization",basic(hr))).andExpect(status().isForbidden());
    }
    @Test void settingsPersistAndEnforceRegistrationAndJobPosting() throws Exception {
        mvc.perform(put("/api/admin/settings").header("Authorization",basic(admin)).contentType(MediaType.APPLICATION_JSON).content("{\"registrationAllowed\":false,\"jobPostingAllowed\":false}"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/admin/settings").header("Authorization",basic(admin))).andExpect(jsonPath("$.registrationAllowed").value(false));
        postJson("/api/auth/register",Map.of("username","disabled-user","password",PASSWORD,"fullName","Disabled","role","CANDIDATE"),null).andExpect(status().isBadRequest());
        postJson("/api/hr/jobs",Map.of("title","Developer","company","Company","city","Pune","type","Full Time"),hr).andExpect(status().isBadRequest());
        mvc.perform(put("/api/admin/settings").header("Authorization",basic(admin)).contentType(MediaType.APPLICATION_JSON).content("{\"registrationAllowed\":null,\"jobPostingAllowed\":true}"))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/settings").header("Authorization",basic(candidate))).andExpect(status().isForbidden());
    }

    @Test void listingCompaniesDoesNotCreateRecordsAndSeedCompaniesAreBackfilledAtStartup() throws Exception {
        for(String name:List.of("TechNova","PixelWorks","CloudAxis","BlueStack"))
            assertTrue(companies.findByNameIgnoreCase(name).isPresent());
        assertTrue(companies.findByNameIgnoreCase("Regression Co").isEmpty());
        long before=companies.count();
        mvc.perform(get("/api/admin/companies").header("Authorization",basic(admin))).andExpect(status().isOk());
        assertEquals(before,companies.count());
        assertTrue(companies.findByNameIgnoreCase("Regression Co").isEmpty());
    }

    @Test void docxMatchingIncludesHeaderFooterAndTableText() throws Exception {
        byte[] bytes;
        try(var document=new XWPFDocument();var output=new ByteArrayOutputStream()) {
            document.createHeader(org.apache.poi.wp.usermodel.HeaderFooterType.DEFAULT).createParagraph().createRun().setText("Java");
            document.createFooter(org.apache.poi.wp.usermodel.HeaderFooterType.DEFAULT).createParagraph().createRun().setText("SQL");
            document.createTable(1,1).getRow(0).getCell(0).setText("React");
            document.write(output);bytes=output.toByteArray();
        }
        var file=new MockMultipartFile("file","header-footer.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",bytes);
        var result=data(mvc.perform(multipart("/api/candidate/resume/upload").file(file).header("Authorization",basic(candidate)))
            .andExpect(status().isOk()).andReturn());
        JsonNode match=null;
        for(JsonNode entry:result.get("matches"))if(entry.get("jobId").asLong()==job.id)match=entry;
        assertNotNull(match);
        assertEquals(100,match.get("score").asInt());
        assertEquals(3,match.get("matchedSkills").size());
    }

    @Test void applicationConflictsAndClosureReturnUsefulErrorsAndRespectOwnership() throws Exception {
        postJson("/api/candidate/jobs/"+job.id+"/apply",Map.of(),candidate)
            .andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("You have already applied for this job."));
        mvc.perform(put("/api/hr/jobs/"+job.id+"/close").header("Authorization",basic(otherHr)))
            .andExpect(status().isNotFound());
        assertTrue(jobs.findById(job.id).orElseThrow().active);
        mvc.perform(put("/api/hr/jobs/"+job.id+"/close").header("Authorization",basic(hr)))
            .andExpect(status().isOk());
        postJson("/api/candidate/jobs/"+job.id+"/apply",Map.of(),candidate)
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("Job is no longer available."));
        assertEquals(1,applications.findByJobId(job.id).size());
    }
}
