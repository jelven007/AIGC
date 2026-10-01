const url = 'https://backend.appmiaoda.com/projects/supabase313589630060507136/rest/v1/video_projects?status=eq.completed';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMDk0MTkyNzk0LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.3UpUbJneKoVq-1JI3dnb1ck6byGIrdBEE-ji9qLntoQ';

fetch(url, {
  method: 'PATCH',
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  },
  body: JSON.stringify({
    video_url: 'https://www.w3schools.com/html/mov_bbb.mp4'
  })
})
.then(async res => {
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
})
.catch(err => {
  console.error('Error:', err);
});
