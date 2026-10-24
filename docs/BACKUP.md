# Backup and restore

## Database

```bash
# Backup
oc exec deploy/quizzical-postgres -- \
  pg_dump -U quizzical quizzical > quizzical-$(date +%F).sql

# Restore (destructive)
oc exec -i deploy/quizzical-postgres -- \
  psql -U quizzical quizzical < quizzical-YYYY-MM-DD.sql
```

On RHEL PostgreSQL images the binary names may be under `/opt/app-root`; adjust if needed:

```bash
oc exec deploy/quizzical-postgres -- bash -lc 'which pg_dump; pg_dump -U quizzical quizzical'
```

## Media PVC

```bash
# Copy media out
oc cp quizzical/$(oc get pod -l app.kubernetes.io/component=api -o name | head -1 | cut -d/ -f2):/data/media ./media-backup

# Copy media in
oc cp ./media-backup/. quizzical/$(oc get pod -l app.kubernetes.io/component=api -o name | head -1 | cut -d/ -f2):/data/media
```

Keep database and media backups from the same point in time so media IDs resolve.
