-- Personal contact details for staff. The login email lives on the user; this is
-- how to reach the person, and it survives removal with the rest of the record.
ALTER TABLE grip.employees
  ADD COLUMN phone          text,
  ADD COLUMN personal_email text,
  ADD COLUMN address        text;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
