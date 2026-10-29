declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SAMARTH_LOCAL_DEMO?: string;
    SAMARTH_BOOTSTRAP_OWNER_EMAIL?: string;
    SAMARTH_AUTH_MODE?: string;
    SAMARTH_SCHEDULER_CONFIGURED?: string;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    SUPABASE_LEGACY_ANON_KEY?: string;
    SAMARTH_DATA_MODE?: string;
    SAMARTH_COHORT_END?: string;
    SAMARTH_ALLOW_SIGNUP?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    SAMARTH_PHONE_GATEWAY_SECRET?: string;
    SAMARTH_PHONE_SENIORS?: string;
    SAMARTH_SPEECH_SECRET?: string;
    SAMARTH_SPEECH_SERVICE_URL?: string;
    SAMARTH_SIM_VOICE_ENABLED?: string;
    SAMARTH_SIM_BRIDGE_SECRET?: string;
  }
}
