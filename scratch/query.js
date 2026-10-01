import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://backend.appmiaoda.com/projects/supabase313589630060507136";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMDk0MTkyNzk0LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.3UpUbJneKoVq-1JI3dnb1ck6byGIrdBEE-ji9qLntoQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data, error } = await supabase.from('video_projects').select('*');
  if (error) {
    console.error("Error fetching video projects:", error);
  } else {
    console.log("Video projects count:", data?.length);
    console.log("First project details:", JSON.stringify(data?.[0], null, 2));
  }
}

run();
