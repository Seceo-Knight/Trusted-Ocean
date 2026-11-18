import { useMemo } from 'react';
import { Alert, Box, Grid, LinearProgress, Stack, Typography } from '@mui/material';
import SensorsRoundedIcon from '@mui/icons-material/SensorsRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import BiotechRoundedIcon from '@mui/icons-material/BiotechRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import KpiTile from '../components/KpiTile';
import Section from '../components/Section';
import OceanMap, { toFeatures } from '../components/OceanMap';
import Chart from '../components/Chart';
import { RampLegend } from '../components/Legend';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { colors } from '../theme';
import { PARAMETERS, PLATFORM_NAMES, SOURCE_COLORS, SOURCE_NAMES, fmtAgo, fmtNumber, rampExpression } from '../lib/format';

export default function Overview() {
  const stats = useApi(() => api.stats(), [], 60000);
  const sources = useApi(() => api.sources(), [], 60000);
  const sst = useApi(async () => {
    const [a, b] = await Promise.all([
      api.latest({ parameter: 'sea_surface_temperature', hours: 48, limit: 20000 }),
      api.latest({ parameter: 'sea_water_temperature', hours: 24 * 10, limit: 20000 }),
    ]);
    return [...a.observations, ...b.observations];
  }, [], 120000);

  const s = stats.data;
  const active24 = s ? s.devices.reduce((n, d) => n + d.active_24h, 0) : null;
  const devicesTotal = s ? s.devices.reduce((n, d) => n + d.devices, 0) : null;
  const obsRows = s ? s.observations.reduce((n, o) => n + Number(o.rows), 0) : null;
  const bio = s && s.biodiversity;
  const srcList = sources.data ? sources.data.sources : [];
  const healthy = srcList.filter((x) => x.status && !x.status.last_error && (x.status.last_success || x.status.running)).length;

  const mapLayers = useMemo(() => [{
    id: 'temperature',
    data: toFeatures(sst.data || [], 'lon', 'lat', (r) => ({ v: r.value, did: r.device_did })),
    color: rampExpression(PARAMETERS.sea_temperature.ramp),
    radius: 3,
  }], [sst.data]);

  const platformChart = useMemo(() => {
    if (!s) return null;
    const rows = s.devices.filter((d) => d.devices > 0);
    return {
      backgroundColor: 'transparent',
      grid: { left: 150, right: 30, top: 10, bottom: 20 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.border } } },
      yAxis: { type: 'category', data: rows.map((d) => `${PLATFORM_NAMES[d.platform] || d.platform}`), axisLabel: { color: colors.muted } },
      series: [{
        type: 'bar', barMaxWidth: 16, name: 'Devices',
        data: rows.map((d) => ({ value: d.devices, itemStyle: { color: SOURCE_COLORS[d.source_id] || colors.cyan, borderRadius: [0, 4, 4, 0] } })),
      }],
    };
  }, [s]);

  return (
    <Stack spacing={2.5}>
      {(stats.error || sources.error) && <Alert severity="error">Cannot reach the backend API. Is the server running (npm start)?</Alert>}
      {stats.loading && !s && <LinearProgress />}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><KpiTile icon={<SensorsRoundedIcon fontSize="small" />} label="Active devices (24 h)" value={fmtNumber(active24)} hint={`${fmtNumber(devicesTotal)} devices known in total`} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><KpiTile icon={<StorageRoundedIcon fontSize="small" />} label="Observations stored" value={fmtNumber(obsRows)} hint="Physical measurements, de-duplicated" accent={colors.purple} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><KpiTile icon={<BiotechRoundedIcon fontSize="small" />} label="eDNA records" value={fmtNumber(bio && bio.rows)} hint={bio ? `${fmtNumber(bio.taxa)} taxa from ${fmtNumber(bio.datasets)} datasets` : ''} accent={colors.amber} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><KpiTile icon={<VerifiedRoundedIcon fontSize="small" />} label="Data sources healthy" value={`${healthy} / ${srcList.length || '-'}`} hint="Every batch signed (ML-DSA-65, quantum-safe)" accent={colors.green} /></Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Section title="Ocean temperature right now" subtitle="Latest sea temperature from buoys, floats and moorings worldwide"
            action={<RampLegend ramp={PARAMETERS.sea_temperature.ramp} unit="°C" />}>
            <OceanMap layers={mapLayers} height={460} center={[40, 15]} zoom={1.3} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {fmtNumber((sst.data || []).length)} stations shown. Quality-flagged bad values are hidden.
            </Typography>
          </Section>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2} sx={{ height: '100%' }}>
            <Section title="Data sources">
              <Stack spacing={1.25}>
                {srcList.map((x) => {
                  const st = x.status || {};
                  const ok = st.last_success && !st.last_error;
                  return (
                    <Box key={x.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: st.running ? colors.amber : ok ? colors.green : st.last_error ? colors.red : colors.faint }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{SOURCE_NAMES[x.id] || x.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {st.running ? 'collecting now' : st.last_error ? `error: ${st.last_error.slice(0, 60)}` : `updated ${fmtAgo(st.last_success || (x.database && x.database.last_batch_at))}`}
                        </Typography>
                      </Box>
                      <Typography variant="caption" sx={{ color: colors.faint }}>{fmtNumber(x.database && x.database.rows_stored)} rows</Typography>
                    </Box>
                  );
                })}
              </Stack>
            </Section>
            <Section title="Devices by platform" sx={{ flex: 1 }}>
              {platformChart && <Chart option={platformChart} height={250} />}
            </Section>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
