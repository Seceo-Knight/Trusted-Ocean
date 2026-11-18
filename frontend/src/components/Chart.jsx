import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

// Minimal ECharts wrapper: re-renders when `option` changes, resizes with its container.
export default function Chart({ option, height = 260 }) {
  const box = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    chart.current = echarts.init(box.current, null, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current && chart.current.resize());
    ro.observe(box.current);
    return () => { ro.disconnect(); chart.current.dispose(); chart.current = null; };
  }, []);
  useEffect(() => { if (chart.current && option) chart.current.setOption(option, true); }, [option]);
  return <div ref={box} style={{ width: '100%', height }} />;
}
