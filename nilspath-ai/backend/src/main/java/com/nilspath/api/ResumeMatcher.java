package com.nilspath.api;

import java.util.*;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/** One scoring policy for candidate analysis and HR screening. */
@Service
public class ResumeMatcher {
    public static final int MAX_TEXT = 150_000;

    public void validate(String resume) {
        if (resume == null || resume.isBlank() || resume.length() > MAX_TEXT)
            throw new IllegalArgumentException("Resume text must contain 1 to 150,000 characters.");
    }

    private String normalize(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9+#.]+", " ").replaceAll("\\s+", " ").trim();
    }

    private String canonicalSkill(String skill) {
        return switch (skill) {
            case "js" -> "javascript";
            case "react.js", "reactjs" -> "react";
            case "springboot" -> "spring boot";
            case "postgres" -> "postgresql";
            case "nodejs", "node" -> "node.js";
            default -> skill;
        };
    }

    private boolean contains(String text, String skill) {
        String term = normalize(skill);
        if (term.isEmpty()) return false;
        List<String> terms = new ArrayList<>(List.of(term));
        terms.addAll(switch (term) {
            case "javascript", "js" -> List.of("javascript", "js");
            case "react", "react.js", "reactjs" -> List.of("react", "react.js", "reactjs");
            case "spring boot", "springboot" -> List.of("spring boot", "springboot");
            case "postgresql", "postgres" -> List.of("postgresql", "postgres");
            case "node.js", "nodejs", "node" -> List.of("node.js", "nodejs", "node");
            default -> List.of();
        });
        return terms.stream().anyMatch(t -> Pattern.compile("(?<![a-z0-9+#])" + Pattern.quote(t) + "(?![a-z0-9+#])").matcher(text).find());
    }

    public List<Map<String,Object>> score(String resume, List<Job> jobs) {
        validate(resume);
        String text = normalize(resume);
        List<Map<String,Object>> result = new ArrayList<>();
        for (Job job : jobs) {
            List<String> required = Arrays.stream(Optional.ofNullable(job.skills).orElse("").split(","))
                .map(this::normalize).filter(s -> !s.isEmpty()).map(this::canonicalSkill).distinct().limit(40).toList();
            List<String> found = required.stream().filter(s -> contains(text, s)).toList();
            List<String> missing = required.stream().filter(s -> !contains(text, s)).toList();
            int percent = required.isEmpty() ? 0 : (int)Math.round(100.0 * found.size() / required.size());
            Map<String,Object> entry = new LinkedHashMap<>();
            entry.put("jobId", job.id); entry.put("title", job.title);
            entry.put("score", percent); entry.put("level", percent >= 70 ? "HIGH" : percent >= 35 ? "MEDIUM" : "LOW");
            entry.put("matched", found.size()); entry.put("total", required.size());
            entry.put("matchedSkills", found); entry.put("missingSkills", missing);
            entry.put("recommendation", required.isEmpty() ? "No required skills listed." : missing.isEmpty() ? "All listed skills found." : "Consider learning: " + String.join(", ", missing));
            result.add(entry);
        }
        result.sort(Comparator.comparingInt((Map<String,Object> m) -> (int)m.get("score")).reversed()
            .thenComparingLong(m -> (Long)m.get("jobId")));
        return result;
    }
}
