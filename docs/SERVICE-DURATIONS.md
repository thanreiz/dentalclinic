# Service durations (seed data)

Chair time per visit, taken from public clinic and professional sources and rounded to the nearest 15 minutes.
The system stores one `duration_minutes` per service and computes each appointment's `end_time` from it, so a
60-minute service at 09:00 blocks 09:00-10:00 for the dentist and the chair (paper Section 3.4.2).

| id | Service | Minutes | Source range found |
|----|---------|---------|--------------------|
| 1 | Oral prophylaxis | 30 | 30-45 (Dental Line) |
| 2 | Tooth filling | 60 | 20-60 (Gallatin Dental, Dental Line) |
| 3 | Tooth extraction | 45 | simple extraction 20-40 (Dental Line), buffered |
| 4 | Exam and X-ray | 30 | 20-40 (Dental Line) |
| 5 | Wisdom tooth removal | 60 | 30-60 chair time, about 90 in the office (Associated OMS); 15-25 for a simple one (Aspen Dental) |
| 6 | Root canal treatment | 90 | 60-90 (Cleveland Clinic), molars 90-120 (Lake Center Smiles) |
| 7 | Crown preparation | 90 | 60-90 first visit (Enamel Dentistry), 30-60 prep for a lab crown (Dental Line) |
| 8 | Braces fitting | 120 | 1-2 hours for the first bonding visit (Stellar Orthodontics) |
| 9 | Braces adjustment | 30 | 15-40 (Stellar Orthodontics, Larson Ortho) |
| 10 | Braces removal | 60 | 30-60 (Hoffman Ortho) |
| 11 | Teeth whitening | 60 | set by the clinic owner |
| 12 | Dental implant | 90 | set by the clinic owner (surgical placement per implant: 60-120 in Dental Line) |

Notes
- Ids 1-3 are the paper's sample services (Tables 3.6 and 3.22); ids 4-12 are additions.
- Ranges are from US clinic web pages, not Philippine data. Treat them as defaults the clinic can edit in Setup.
- Dr. Cruz has no seeded appointments, so the October 2026 report totals still match Table 3.22.
- The seed only affects `npm run db:reset` and local/demo databases. A hosted database keeps its current services
  until they are added in Setup.
