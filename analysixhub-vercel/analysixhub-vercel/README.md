# AnalysixHub on Vercel (free)

Folders: public (website + admin page), api and lib (the form, admin login, projects, pictures), vercel.json, package.json.
Keep all names exactly as they are, including api/[...path].js

1. Make a free account at vercel.com (choose Continue with GitHub).
2. GitHub: create a NEW repository called analysixhub-vercel. Upload the CONTENTS of this folder (api, lib, public, package.json, vercel.json). The top level of the repository must show those, not one outer folder.
3. Vercel: Add New > Project > import analysixhub-vercel. Framework Preset: Other. Leave the other settings. Click Deploy.
4. In the project: Storage tab > Create Database > Neon (Postgres) > Free plan > connect to this project (all environments). This adds DATABASE_URL by itself.
5. Settings > Environment Variables > add ADMIN_PASSWORD (a strong password only you know). Save.
6. Deployments > newest > the three dots > Redeploy (new settings only apply to a new deployment).
7. Open your address (something.vercel.app). Test: add /api/content to the address, you should see {"text":{},"settings":{}}. Admin page: add /admin. Username: admin.

Errors:
- "Database is not connected": redo step 4, then step 6.
- "Admin password is not set": redo step 5, then step 6.
- 404 on /api/content: the api folder is missing or in the wrong place. If your files are inside an outer folder, in Vercel open Settings > General > Root Directory and type that folder name.
