package com.nilspath.api;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ResumeMatcherTest {
    private final ResumeMatcher matcher=new ResumeMatcher();
    private Job job(long id,String skills) {
        Job job=new Job("Developer","Company","Pune","Full Time",skills,0,null); job.id=id; return job;
    }
    @Test void matchesAliasesAndSentencePunctuationWithoutSubstringFalsePositives() {
        var result=matcher.score("Java. React.js; JS, SpringBoot and PostgreSQL.",List.of(job(1,"java,react,javascript,spring boot,sql"))).get(0);
        assertEquals(80,result.get("score"));
        assertEquals(List.of("sql"),result.get("missingSkills"));
        assertEquals(0,matcher.score("JavaScript, C++",List.of(job(2,"java,c"))).get(0).get("score"));
    }
    @Test void ranksJobsAndNormalizesDuplicateSkills() {
        var result=matcher.score("Java",List.of(job(1,"sql"),job(2,"Java,java,JAVA")));
        assertEquals(2L,result.get(0).get("jobId"));
        assertEquals(100,result.get(0).get("score"));
        assertEquals(1,result.get(0).get("total"));
        assertEquals("LOW",result.get(1).get("level"));
    }
    @Test void supportedAliasesMatchInBothDirectionsWithoutMatchingSubstrings() {
        var result=matcher.score("JavaScript, React, Spring Boot, PostgreSQL and Node.js",
            List.of(job(1,"js,reactjs,springboot,postgres,nodejs"))).get(0);
        assertEquals(100,result.get("score"));
        assertEquals(0,matcher.score("json reactive springbootcamp postgresqlish nodejscript",
            List.of(job(2,"js,reactjs,springboot,postgres,nodejs"))).get(0).get("score"));
    }
    @Test void validatesNullBlankAndOversizedResumes() {
        for (String resume : Arrays.asList(null,"","   ","x".repeat(150001)))
            assertThrows(IllegalArgumentException.class,()->matcher.score(resume,List.of()));
    }
    @Test void duplicateAliasesDoNotInflateScoresOrRepeatMissingSkills() {
        var result=matcher.score("JavaScript",List.of(job(1,"javascript,JS,sql"))).get(0);
        assertEquals(50,result.get("score"));
        assertEquals(2,result.get("total"));
        assertEquals(List.of("javascript"),result.get("matchedSkills"));
        var missing=matcher.score("Java",List.of(job(2,"react,react.js,ReactJS,node,nodejs,node.js"))).get(0);
        assertEquals(List.of("react","node.js"),missing.get("missingSkills"));
        assertEquals(2,missing.get("total"));
    }
    @Test void appliesSameThresholdsAndHandlesJobsWithoutSkills() {
        assertEquals("MEDIUM",matcher.score("java sql",List.of(job(1,"java,sql,react"))).get(0).get("level"));
        assertEquals("LOW",matcher.score("java",List.of(job(1,null))).get(0).get("level"));
        assertEquals("No required skills listed.",matcher.score("java",List.of(job(1,""))).get(0).get("recommendation"));
    }
}
