-- VT Suite Database Schema

CREATE DATABASE IF NOT EXISTS vt_suite;

USE vt_suite;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_name VARCHAR(150) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    company_name VARCHAR(150) NOT NULL,
    service_needed VARCHAR(100) DEFAULT 'full_suite',
    trial_ends_at DATETIME NULL,
    trial_status VARCHAR(20) DEFAULT 'active',
    reminder_sent_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
