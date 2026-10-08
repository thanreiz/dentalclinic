-- Dental Clinic Appointment System schema.
-- Below the DROP block is Listing 3.2 from the paper (docs/PRD.md "Data Model"), copied exactly.
-- Do not edit the CREATE TABLE statements: the paper is the contract (NF02).
-- The DROP block only exists so `npm run db:reset` can rebuild from scratch (reverse FK order).

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS chairs;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS dentist_schedules;
DROP TABLE IF EXISTS dentists;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  user_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name      VARCHAR(100) NOT NULL,
  email     VARCHAR(150) NOT NULL,
  password  VARCHAR(255) NOT NULL,
  CONSTRAINT pk_users PRIMARY KEY (user_id),
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE patients (
  patient_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name       VARCHAR(150) NOT NULL,
  contact_number  VARCHAR(20)  NOT NULL,
  email           VARCHAR(150) NULL,
  birthdate       DATE         NOT NULL,
  CONSTRAINT pk_patients PRIMARY KEY (patient_id),
  CONSTRAINT uq_patients_contact UNIQUE (contact_number)
);

CREATE TABLE dentists (
  dentist_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dentist_name  VARCHAR(100) NOT NULL,
  CONSTRAINT pk_dentists PRIMARY KEY (dentist_id)
);

CREATE TABLE dentist_schedules (
  schedule_id  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  dentist_id   INT UNSIGNED     NOT NULL,
  day_of_week  TINYINT UNSIGNED NOT NULL,
  start_time   TIME             NOT NULL,
  end_time     TIME             NOT NULL,
  CONSTRAINT pk_dentist_schedules PRIMARY KEY (schedule_id),
  CONSTRAINT fk_schedules_dentist FOREIGN KEY (dentist_id)
    REFERENCES dentists (dentist_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT uq_dentist_day UNIQUE (dentist_id, day_of_week),
  CONSTRAINT chk_day_of_week CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_schedule_hours CHECK (end_time > start_time)
);

CREATE TABLE services (
  service_id        INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  service_name      VARCHAR(100)      NOT NULL,
  duration_minutes  SMALLINT UNSIGNED NOT NULL,
  CONSTRAINT pk_services PRIMARY KEY (service_id),
  CONSTRAINT uq_service_name UNIQUE (service_name),
  CONSTRAINT chk_duration CHECK (duration_minutes > 0)
);

CREATE TABLE chairs (
  chair_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chair_name  VARCHAR(50)  NOT NULL,
  CONSTRAINT pk_chairs PRIMARY KEY (chair_id),
  CONSTRAINT uq_chair_name UNIQUE (chair_name)
);

CREATE TABLE appointments (
  appointment_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id           INT UNSIGNED NOT NULL,
  dentist_id           INT UNSIGNED NOT NULL,
  service_id           INT UNSIGNED NOT NULL,
  chair_id             INT UNSIGNED NULL,
  appointment_date     DATE         NOT NULL,
  start_time           TIME         NOT NULL,
  end_time             TIME         NOT NULL,
  status               ENUM('pending','scheduled','attended',
                            'cancelled','declined','no-show') NOT NULL,
  channel              ENUM('online','phone','chat','walk-in') NOT NULL,
  requested_at         DATETIME     NOT NULL,
  patient_note         TEXT         NULL,
  dentist_note         TEXT         NULL,
  reminder_sent_at     DATETIME     NULL,
  rescheduled_from_id  INT UNSIGNED NULL,
  CONSTRAINT pk_appointments PRIMARY KEY (appointment_id),
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id)
    REFERENCES patients (patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_dentist FOREIGN KEY (dentist_id)
    REFERENCES dentists (dentist_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_service FOREIGN KEY (service_id)
    REFERENCES services (service_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_chair FOREIGN KEY (chair_id)
    REFERENCES chairs (chair_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_rescheduled FOREIGN KEY (rescheduled_from_id)
    REFERENCES appointments (appointment_id) ON DELETE RESTRICT,
  CONSTRAINT chk_appt_times CHECK (end_time > start_time)
);
