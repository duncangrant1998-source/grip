-- What a part fits, in the words a counter person would use ("Toyota Camry 2012-2017").
-- Searching parts by VIN decodes the VIN to a vehicle and matches it against this
-- and the description.
ALTER TABLE grip.parts ADD COLUMN fitment text;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
