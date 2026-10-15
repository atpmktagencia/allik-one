ALTER TABLE "inventory_care_appointment_changes" DROP CONSTRAINT "care_appointment_change_action_valid";
--> statement-breakpoint
ALTER TABLE "inventory_care_appointment_changes" ADD CONSTRAINT "care_appointment_change_action_valid" CHECK ("action" IN ('CREATE','UPDATE','RESCHEDULE','STATUS'));
