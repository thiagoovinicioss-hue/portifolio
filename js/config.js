// Centralized site configuration.
// Values here are public by design (served to the browser).
// NEVER put secrets here. Database access is protected server-side (RLS + Supabase Auth).

export const CONFIG = {
  // Basic identity
  name: 'Thiago Vinícius',
  brand: ['Thiago', 'Vinícius'],
  country: 'Brasil',

  // Profile image (about / hero). Optimized WebP in /assets.
  profileImage: 'assets/profile.webp',
  profileImageWidth: 480,
  profileImageHeight: 600,

  // Social & contact links.
  social: {
    linkedin: 'https://www.linkedin.com/in/thiagovin%C3%ADciusbara%C3%BAjo/',
    instagram: 'https://www.instagram.com/thiagovinnicius14/',
    whatsapp: '#', // filled below from whatsapp.number
    github: 'https://github.com/thiagoovinicioss-hue',
  },

  // WhatsApp number used for the quote flow.
  // Format: country code + area code + number, digits only.
  whatsapp: {
    number: '5544988562515',
  },

  // Lead storage + authentication backend (Supabase).
  // The publishable/anon key below is PUBLIC by design (safe to ship to the
  // browser). It lets supabase-js sign in with email/password for the private
  // area. The SERVICE ROLE key (sb_secret_*) is NEVER placed here or anywhere
  // in this repository: it lives only in the backend's environment.
  //
  // Quote submissions are saved through the backend (POST /api/leads, service
  // role server-side). The anon key is only used for the direct-insert
  // fallback when apiBaseUrl is empty and for the admin's Supabase Auth login.
  supabase: {
    url: 'https://eimtmksxkojpqjsdiwmn.supabase.co',
    anonKey: 'sb_publishable_CQjrAVAReTakJU4jMiuR5A_AWmJTqyn',
    leadsTable: 'leads',
  },

  // Lead status values used in the admin panel.
  statuses: ['new', 'contacted', 'negotiation', 'won', 'lost'],

  // Private-area backend. Authentication happens with Supabase Auth
  // (email/password) directly from this page; the access token is then sent to
  // the backend, which verifies it server-side, checks the configured admin
  // user, and only then proxies private lead data. No token handling here.
  // Leave apiBaseUrl empty to run the site with the private area disabled.
  auth: {
    // e.g. 'https://api.example.com'  (no trailing slash)
    apiBaseUrl: 'https://tv-portfolio-api.onrender.com',
  },
};

export function whatsappUrl(message) {
  if (!CONFIG.whatsapp.number) return '#';
  return `https://wa.me/${CONFIG.whatsapp.number}?text=${encodeURIComponent(message)}`;
}

export function isBackendConfigured() {
  return Boolean(CONFIG.supabase.url && CONFIG.supabase.anonKey);
}

export function isAuthConfigured() {
  // The private area needs both the Supabase client (sign-in) and the backend
  // (authorized data/leads gateway).
  return Boolean(isBackendConfigured() && CONFIG.auth.apiBaseUrl);
}