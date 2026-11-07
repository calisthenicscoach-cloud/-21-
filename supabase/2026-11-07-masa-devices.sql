-- ============================================================
--  מסע הכוח: מקישור קבוע לקישור חד-פעמי + מכשירים
--  להריץ פעם אחת ב-SQL Editor של Supabase (פרויקט course).
-- ============================================================
--
-- ‼️ למה
--
-- עד היום מייל הגישה הכיל קישור קבוע: /app/?k=<token>. מי שמחזיק
-- בקישור נכנס, תמיד, ואפשר להעביר אותו לכמה אנשים שרוצים.
--
-- בקורס 21 יום זה לא ככה: שם יש חשבון אמיתי לכל קונה, והמייל מכיל
-- קישור חד-פעמי שפג. העברה לחבר נותנת לו כניסה אחת לכל היותר, וכדי
-- להיכנס שוב צריך קישור חדש — שנשלח לתיבה של הקונה.
--
-- הקובץ הזה מביא את אותה תכונה למסע הכוח:
--   masa_access.code        — קוד חד-פעמי שנשלח במייל
--   masa_access.code_used_at — מתי מומש. אחרי זה הוא מת.
--   masa_devices            — שורה לכל מכשיר שנפתח עם קוד תקף
--
-- ‼️ ה-GRANT בסוף הוא לא קישוט. טבלה שנוצרת כאן מגיעה בלי הרשאות
--    ל-service_role, ואז PostgREST מחזיר 42501 permission denied —
--    ו-fetch לא זורק על 403, אז הכתיבות נכשלות בשקט.

-- ---- 1. הקוד החד-פעמי ----
alter table masa_access add column if not exists code         text;
alter table masa_access add column if not exists code_sent_at timestamptz;
alter table masa_access add column if not exists code_used_at timestamptz;

create unique index if not exists masa_access_code_idx
  on masa_access (code) where code is not null;

-- ---- 2. המכשירים ----
create table if not exists masa_devices (
  id           bigserial primary key,
  access_id    bigint      not null references masa_access(id) on delete cascade,
  token        text        not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  user_agent   text
);

create index if not exists masa_devices_access_idx on masa_devices (access_id);

-- ---- 3. ‼️ הרשאות ----
grant select, insert, update, delete on masa_access  to service_role;
grant select, insert, update, delete on masa_devices to service_role;
grant usage, select on sequence masa_devices_id_seq  to service_role;

-- ---- 4. בדיקה שהכל במקום ----
select
  (select count(*) from information_schema.columns
     where table_name = 'masa_access'
       and column_name in ('code', 'code_sent_at', 'code_used_at')) as new_columns,   -- צריך 3
  (select count(*) from information_schema.tables
     where table_name = 'masa_devices')                             as devices_table, -- צריך 1
  (select count(*) from information_schema.role_table_grants
     where grantee = 'service_role' and table_name = 'masa_devices') as device_grants; -- צריך 4
