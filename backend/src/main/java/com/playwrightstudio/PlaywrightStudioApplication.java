package com.playwrightstudio;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PlaywrightStudioApplication {

    public static void main(String[] args) {
        SpringApplication.run(PlaywrightStudioApplication.class, args);
    }
}
