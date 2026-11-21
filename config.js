// Cloud sync settings. Fill these in from Supabase: Project Settings > API.
// The publishable (or legacy "anon public") key is meant to be used in apps like this one; your data is protected
// by sign-in and the row level security rules in supabase/schema.sql.
// Leave them blank to use the tracker without cloud sync (claims stay on this device only).
window.TRACKER_CONFIG = {
  supabaseUrl: 'https://xvhhhhugwsoxytovhhbb.supabase.co',
  supabaseAnonKey: 'sb_publishable_IAAhXqHGPj5DoYrfXf0kuQ_flUN4d70'
};
