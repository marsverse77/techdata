# TechData registration desk

Event check-in for techdata.marsverse.id. Add guests individually or import a UTF-8 CSV with these headers:

```
Full Name,Email,Country of origin,Company,Title
```

Open a guest's pass to print it or copy its individual mobile link. On the Check-in desk, focus the scanner field and use a USB or Bluetooth QR reader in keyboard mode with an Enter suffix. The camera scanner is also available over HTTPS. The first accepted scan marks the guest present and records server time. Repeat scans show that same time.

## Hostinger deployment

Connect this repository's main branch to the domain's PHP website root and enable automatic deployment. The application requires PHP 8.1+ with sessions and a writable directory above the document root. There are no database-server, build, or package-install steps. Guest records and staff settings are stored under `../techdata-private/` using serialized writes and atomic replacement. Include that directory in private backups. Never commit it or move it into the public website. Serve the app with HTTPS.

On first use, open the site once, then find `techdata-private/setup-code.txt` beside `public_html` in the hosting file manager. Use the one-time code and choose a staff password on the activation screen. Activation removes the code. Staff can then sign in on each check-in device. To run a disposable local instance, use `php -S 127.0.0.1:8080` from the project with `TECHDATA_STORAGE` pointing to a private temporary directory outside the project.

QR passes contain a random ID. A guest can display a pass without signing in. Only an authenticated desk session can read the full roster or mark attendance. The attendance CSV export includes the five participant fields, status and check-in time. The pass distribution export includes a unique link for each guest.


## Inspire attendance and walk-ins

Import the Inspire sheet of an Excel workbook, or import an Inspire CSV. The importer reads category, first and last names, email, company, job title and country. A matching email keeps its Inspire pass and check-in. For a row without email, the guest’s name and company identify the existing Inspire pass.

Guest directory → Export provides one QR-only PDF per Inspire registration, named by category and guest name. Historical RLS-only passes do not admit guests. The original IDs of shared Inspire guests continue to work.

Choose Walk-In Participants → Register walk-in to enter an on-site guest and immediately mark them present. Walk-ins have a separate register and attendance CSV, and do not receive QR passes.

Backup writes a full snapshot under techdata-private/backups on Hostinger. Reset attendance saves a backup first, then clears check-in times for the selected list. To recover the full desk, restore a chosen snapshot as techdata-private/desk.json during a maintenance window. The snapshot includes the staff password hash in effect at that time.
