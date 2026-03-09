import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://esktjpklhtjfomraehgt.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVza3RqcGtsaHRqZm9tcmFlaGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDUxNTQsImV4cCI6MjA4ODU4MTE1NH0.RDMAXa15CQcTBDxewcX5yd76C3iG6aW0o6csGckJAx4";

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;