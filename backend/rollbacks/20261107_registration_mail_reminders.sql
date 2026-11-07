-- Disable EMAIL_NOTIFICATIONS_ENABLED and restart backend before rollback.
-- Existing in-app notifications remain untouched.
BEGIN;
DROP FUNCTION IF EXISTS public.enqueue_registration_mail_reminders();
COMMIT;
