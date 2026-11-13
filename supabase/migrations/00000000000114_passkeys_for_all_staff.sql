-- Face ID / fingerprint login: open to all staff (administrators, bar
-- managers, bartenders), still not customers. Can be changed back on an
-- administrator's profile page ("מי יכול להפעיל").
update app_settings set passkey_audience = 'staff' where id;
