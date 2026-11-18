import { Alert, Box, Chip, Grid, Link, Stack, Typography } from '@mui/material';
import Section from '../components/Section';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { colors } from '../theme';
import { SOURCE_COLORS, SOURCE_NAMES, fmtAgo, fmtNumber, fmtTime } from '../lib/format';

function Row({ label, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, py: 0.6 }}>
      <Typography variant="caption" sx={{ width: 130, flexShrink: 0, color: colors.faint }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: colors.text, wordBreak: 'break-word' }}>{children}</Typography>
    </Box>
  );
}

export default function Sources() {
  const sources = useApi(() => api.sources(), [], 30000);
  const list = sources.data ? sources.data.sources : [];
  return (
    <Stack spacing={2}>
      {sources.error && <Alert severity="error">Cannot reach the backend API.</Alert>}
      <Typography color="text.secondary" variant="body2">
        Every source is public, real and licensed for use. Each collection run is stored with a SHA-256 fingerprint of exactly what the provider sent.
      </Typography>
      <Grid container spacing={2}>
        {list.map((s) => {
          const st = s.status || {};
          const db = s.database || {};
          const state = st.running ? ['Collecting', colors.amber] : st.last_error ? ['Error', colors.red] : st.last_success ? ['Healthy', colors.green] : ['Waiting', colors.faint];
          return (
            <Grid key={s.id} size={{ xs: 12, lg: 6 }}>
              <Section
                title={SOURCE_NAMES[s.id] || s.name}
                subtitle={s.name}
                action={<Chip size="small" label={state[0]} sx={{ bgcolor: `${state[1]}22`, color: state[1], fontWeight: 600 }} />}
                sx={{ height: '100%', borderTop: `3px solid ${SOURCE_COLORS[s.id] || colors.cyan}` }}
              >
                <Row label="Schedule">every {s.interval_minutes >= 60 ? `${s.interval_minutes / 60} h` : `${s.interval_minutes} min`}{s.enabled ? '' : ' (disabled)'}</Row>
                <Row label="Last success">{st.last_success ? `${fmtTime(st.last_success)} (${fmtAgo(st.last_success)})` : db.last_batch_at ? `${fmtTime(db.last_batch_at)} (${fmtAgo(db.last_batch_at)})` : 'not yet'}</Row>
                {st.last_error && <Row label="Last error"><Box component="span" sx={{ color: colors.red }}>{st.last_error}</Box></Row>}
                <Row label="Last run">{st.stations !== undefined ? `${fmtNumber(st.stations)} stations, ${fmtNumber(st.observations)} values` : '-'}</Row>
                <Row label="Stored">{fmtNumber(db.rows_stored)} rows in {fmtNumber(db.batches)} batches</Row>
                <Row label="Licence">{s.licence}</Row>
                <Row label="Attribution">{s.attribution}</Row>
              </Section>
            </Grid>
          );
        })}
      </Grid>
      <Typography variant="caption" color="text.secondary">
        Coastlines: <Link href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer" color="inherit">Natural Earth</Link> (public domain).
      </Typography>
    </Stack>
  );
}
