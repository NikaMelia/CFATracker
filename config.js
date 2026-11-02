// Supabase connection for login + cloud sync. Leave the URL/key empty to run in local-only mode
// (data saved in the browser, no login). See README → "Login & sync setup".
// The publishable / anon key is meant to be public; Row Level Security keeps each user's data private.
window.CFA_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",  // Project Settings → API Keys → publishable (or legacy "anon public") key
  // People sign up with a username; behind the scenes it is stored as "<username>@<usernameDomain>".
  // No email is ever sent (email confirmation must be off). Don't change this once people have accounts.
  usernameDomain: "nikamelia.github.io",
};
