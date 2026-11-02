// Supabase connection for login + cloud sync. Leave both empty to run in local-only mode
// (data saved in the browser, no login). See README → "Login & sync setup".
// The anon / publishable key is meant to be public; Row Level Security keeps each user's data private.
window.CFA_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",  // Project Settings → API Keys → publishable (or legacy "anon public") key
};
