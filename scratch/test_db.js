import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://backend.appmiaoda.com/projects/supabase313589630060507136';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMDk0MTkyNzk0LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.3UpUbJneKoVq-1JI3dnb1ck6byGIrdBEE-ji9qLntoQ';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log('Logging in...');
  // Sign in with demo account
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'demo_user@example.com',
    password: 'demo123456'
  });

  if (authError) {
    console.error('Login failed:', authError.message);
    // Try sign up or other demo account if fails
    return;
  }

  const user = authData.user;
  console.log('Logged in as:', user.email, 'ID:', user.id);

  console.log('\n--- Testing Team Creation ---');
  // Try inserting a team
  const teamName = 'Test Team ' + Date.now();
  const { data: teamData, error: teamErr } = await supabase
    .from('teams')
    .insert({ name: teamName, owner_id: user.id })
    .select()
    .maybeSingle();

  if (teamErr) {
    console.error('Team insertion failed:', teamErr);
  } else {
    console.log('Team inserted successfully:', teamData);

    // Try inserting team member
    const { data: memData, error: memErr } = await supabase
      .from('team_members')
      .insert({ team_id: teamData.id, user_id: user.id, role: 'owner', status: 'active' })
      .select();

    if (memErr) {
      console.error('Member insertion failed:', memErr);
    } else {
      console.log('Member inserted successfully:', memData);
    }
  }

  console.log('\n--- Testing API Key Creation ---');
  // Try inserting an API Key
  const rawKey = 'ak_test_' + Date.now();
  const prefix = rawKey.slice(0, 10);
  const keyHash = 'hash_' + Date.now();
  
  const { data: keyRecord, error: keyErr } = await supabase
    .from('api_keys')
    .insert({
      user_id: user.id,
      name: 'Test Key',
      key_hash: keyHash,
      key_prefix: prefix,
      scopes: ['video:create', 'script:generate'],
      rate_limit: 100,
      is_active: true,
      total_calls: 0
    })
    .select()
    .maybeSingle();

  if (keyErr) {
    console.error('API Key insertion failed:', keyErr);
  } else {
    console.log('API Key inserted successfully:', keyRecord);
  }
}

run();
