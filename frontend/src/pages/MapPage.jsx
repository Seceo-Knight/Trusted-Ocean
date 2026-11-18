import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Chip, CircularProgress, Divider, Drawer, FormControl, IconButton, InputLabel, MenuItem, Select, Stack,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import Section from '../components/Section';
import OceanMap, { toFeatures } from '../components/OceanMap';
import Chart from '../components/Chart';
import { RampLegend } from '../components/Legend';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { colors } from '../theme';
import {
  MAP_PARAMETERS, PARAMETERS, SOURCE_COLORS, SOURCE_NAMES,
  fmtAgo, fmtTime, fmtValue, paramLabel, rampExpression, unitLabel,
} from '../lib/format';

const SOURCES = ['ndbc', 'argo', 'copernicus'];
const QC = { 1: ['good', colors.green], 4: ['bad', colors.red], 0: ['not checked', colors.faint] };

const INFO_PARAMS = ['argo_cycle_number']; // bookkeeping values, shown as labels not measurements

function DevicePanel({ did, onClose, preferred = [] }) {
  const [param, setParam] = useState(null);
  const ts = useApi(() => api.timeseries(did, { from: new Date(Date.now() - 30 * 86400000).toISOString(), limit: 20000 }), [did]);
  const points = ts.data ? ts.data.points : [];
  const latest = useMemo(() => {
    const m = new Map();
    for (const p of points) if (!m.has(p.parameter) && !INFO_PARAMS.includes(p.parameter)) m.set(p.parameter, p);
    return [...m.values()];
  }, [points]);
  const cycle = points.find((p) => p.parameter === 'argo_cycle_number');
  useEffect(() => {
    if (!param && latest.length) {
      // open on the parameter the map is showing, if this station measures it
      const pref = latest.find((p) => preferred.includes(p.parameter)) || latest.find((p) => PARAMETERS[p.parameter]) || latest[0];
      setParam(pref.parameter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, param, preferred.join(',')]);
  const series = useMemo(() => points.filter((p) => p.parameter === param && p.qc_flag !== 4).map((p) => [p.time, p.value]).reverse(), [points, param]);
  const unit = latest.find((p) => p.parameter === param);
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time', axisLabel: { color: colors.muted }, axisLine: { lineStyle: { color: colors.border } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.border } } },
    series: [{
      type: 'line', data: series, showSymbol: series.length < 40, symbolSize: 5, smooth: true, name: paramLabel(param || ''),
      lineStyle: { color: colors.cyan, width: 2 }, itemStyle: { color: colors.cyan },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(6,182,212,0.35)' }, { offset: 1, color: 'rgba(6,182,212,0)' }] } },
    }],
  }), [series, param]);
  const id = did.split(':').pop();
  const source = did.split(':')[4];

  return (
    <Box sx={{ width: { xs: '100vw', sm: 440 }, p: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" sx={{ color: SOURCE_COLORS[source] }}>{SOURCE_NAMES[source] || source}</Typography>
          <Typography variant="h6">Station {id.toUpperCase()}</Typography>
          {cycle && <Typography variant="body2" color="text.secondary">Dive cycle {cycle.value}</Typography>}
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{did}</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close"><CloseRoundedIcon /></IconButton>
      </Box>
      <Divider sx={{ my: 2 }} />
      {ts.loading && !ts.data && <CircularProgress size={24} />}
      {ts.error && <Alert severity="error">{ts.error.message}</Alert>}
      {ts.data && !latest.length && <Typography color="text.secondary">No measurements in the last 30 days.</Typography>}
      {latest.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Latest values (click one to chart it)</Typography>
          <Stack spacing={0.75}>
            {latest.map((p) => (
              <Box key={p.parameter} onClick={() => setParam(p.parameter)} sx={{
                display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.9, borderRadius: 2, cursor: 'pointer',
                bgcolor: p.parameter === param ? 'rgba(6,182,212,0.12)' : 'rgba(148,163,184,0.05)',
                border: `1px solid ${p.parameter === param ? 'rgba(6,182,212,0.4)' : 'transparent'}`,
              }}>
                <Typography sx={{ flex: 1, fontSize: 13 }}>{paramLabel(p.parameter)}</Typography>
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{fmtValue(p.value)} <Box component="span" sx={{ color: colors.muted, fontWeight: 500, fontSize: 12 }}>{unitLabel(p.unit, p.parameter)}</Box></Typography>
                <Box title={`quality: ${(QC[p.qc_flag] || QC[0])[0]}`} sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: (QC[p.qc_flag] || QC[0])[1] }} />
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Observed {fmtTime(latest[0].time)} ({fmtAgo(latest[0].time)})</Typography>
          <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 0.5 }}>{paramLabel(param || '')} {unit ? `(${unitLabel(unit.unit, param)})` : ''}, last 30 days</Typography>
          <Chart option={option} height={240} />
          <Typography variant="caption" color="text.secondary">{series.length} measurements, bad-quality values excluded</Typography>
        </>
      )}
    </Box>
  );
}

export default function MapPage() {
  const [param, setParam] = useState('sea_temperature');
  const [sources, setSources] = useState(SOURCES);
  const [selected, setSelected] = useState(null);
  // floats report every few days, so look further back for parameters they measure
  const hoursFor = (p) => (p === 'sea_water_temperature' || p === 'sea_water_practical_salinity' ? 240 : 48);

  const devices = useApi(() => api.devices({ active_hours: 240, limit: 20000 }), [], 120000);
  const values = useApi(async () => {
    const parts = PARAMETERS[param].combine || [param];
    const res = await Promise.all(parts.map((p) => api.latest({ parameter: p, hours: hoursFor(p), limit: 50000 })));
    return { observations: res.flatMap((r) => r.observations) };
  }, [param], 120000);

  const layers = useMemo(() => {
    const byDid = new Map((values.data ? values.data.observations : []).map((o) => [o.device_did, o.value]));
    const rows = (devices.data ? devices.data.devices : []).filter((d) => SOURCES.includes(d.source_id));
    const def = PARAMETERS[param];
    return SOURCES.map((src) => {
      const mine = rows.filter((d) => d.source_id === src);
      // stations without this parameter are drawn small and grey under the coloured ones
      const withValue = mine.filter((d) => byDid.has(d.did)).map((d) => ({ ...d, v: byDid.get(d.did) }));
      const without = mine.filter((d) => !byDid.has(d.did));
      return [
        { id: `${src}-other`, data: toFeatures(without, 'lon', 'lat', (d) => ({ did: d.did })), color: '#334155', radius: 2, visible: sources.includes(src) },
        { id: `${src}-value`, data: toFeatures(withValue, 'lon', 'lat', (d) => ({ did: d.did, v: d.v })), color: rampExpression(def.ramp), radius: src === 'argo' ? 3.5 : 3, visible: sources.includes(src) },
      ];
    }).flat();
  }, [devices.data, values.data, param, sources]);

  const shown = layers.filter((l) => l.visible !== false && l.id.endsWith('-value')).reduce((n, l) => n + l.data.features.length, 0);
  const total = layers.filter((l) => l.visible !== false).reduce((n, l) => n + l.data.features.length, 0);

  return (
    <Stack spacing={2}>
      <Section
        title={PARAMETERS[param].label}
        subtitle={`${shown.toLocaleString('en-US')} stations with a value, ${total.toLocaleString('en-US')} stations shown. Click a point for its details and history.`}
        action={<RampLegend ramp={PARAMETERS[param].ramp} unit={PARAMETERS[param].unit} />}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel id="param">Parameter</InputLabel>
            <Select labelId="param" label="Parameter" value={param} onChange={(e) => setParam(e.target.value)}>
              {MAP_PARAMETERS.map((p) => <MenuItem key={p} value={p}>{PARAMETERS[p].label}</MenuItem>)}
            </Select>
          </FormControl>
          <ToggleButtonGroup size="small" value={sources} onChange={(e, v) => v.length && setSources(v)}>
            {SOURCES.map((s) => (
              <ToggleButton key={s} value={s} sx={{ px: 1.5, gap: 1 }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: SOURCE_COLORS[s] }} />{SOURCE_NAMES[s]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {(devices.loading || values.loading) && <CircularProgress size={18} />}
          <Box sx={{ flex: 1 }} />
          <Chip size="small" variant="outlined" label="Grey = station does not measure this" />
        </Box>
        {(devices.error || values.error) && <Alert severity="error" sx={{ mb: 2 }}>Cannot load map data from the backend.</Alert>}
        <OceanMap layers={layers} height="calc(100vh - 260px)" center={[60, 10]} zoom={1.6}
          onSelect={(f) => setSelected(f.properties.did)} />
      </Section>
      <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { bgcolor: colors.paper, borderLeft: `1px solid ${colors.border}` } } }}>
        {selected && <DevicePanel key={selected} did={selected} onClose={() => setSelected(null)} preferred={PARAMETERS[param].combine || [param]} />}
      </Drawer>
    </Stack>
  );
}

