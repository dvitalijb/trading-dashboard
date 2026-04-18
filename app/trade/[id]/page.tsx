'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createChart } from 'lightweight-charts';
import { Maximize2, Minimize2, ArrowLeft, DollarSign, Shield, CheckCircle, Clock, BarChart2 } from 'lucide-react';

interface Trade {
  position_id: number;
  symbol: string;
  type: string;
  entry_price: string;
  exit_price: string;
  profit: string;
  commission: string;
  swap: string;
  net_profit: string;
  entry_time: number;
  exit_time: number;
  volume: string;
  ticket?: number;
  magic?: number;
  comment?: string;
  isNew?: boolean;
}

const parseNumber = (str: string | number) => {
  let cleaned = String(str).replace(/&nbsp;/g, '').replace(/\s/g, '');
  cleaned = cleaned.replace(/[^0-9.-]/g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export default function TradeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const [trade, setTrade] = useState<Trade | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem('selectedTrade');
    if (saved) {
      const parsed = JSON.parse(saved);
      setTrade(parsed);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!trade || !chartContainerRef.current) return;

    const isProfit = parseNumber(trade.profit) >= 0;
    const entryPrice = parseNumber(trade.entry_price);
    const exitPrice = parseNumber(trade.exit_price);

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: '#020617' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
      },
      width: chartContainerRef.current.clientWidth || 800,
      height: 600,
    });

    chartRef.current = chart;

    const lineSeries = chart.addLineSeries({
      color: isProfit ? '#10b981' : '#f43f5e',
      lineWidth: 2,
      lineStyle: 2,
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    const tradeData = [
      { time: trade.entry_time, value: entryPrice },
      { time: trade.exit_time, value: exitPrice }
    ];

    const entryMarker = {
      time: trade.entry_time,
      position: 'belowBar',
      color: '#10b981',
      shape: 'arrowUp',
      text: 'Entry',
      size: 2,
    };

    const exitMarker = {
      time: trade.exit_time,
      position: 'aboveBar',
      color: '#f43f5e',
      shape: 'arrowDown',
      text: 'Exit',
      size: 2,
    };

    lineSeries.setData(tradeData);
    candlestickSeries.setMarkers([entryMarker, exitMarker]);

    const entryPriceLine = lineSeries.createPriceLine({
      price: entryPrice,
      color: '#10b981',
      lineWidth: 1,
      lineStyle: 1,
      axisLabelVisible: true,
      title: 'Entry',
    });

    const exitPriceLine = lineSeries.createPriceLine({
      price: exitPrice,
      color: '#f43f5e',
      lineWidth: 1,
      lineStyle: 1,
      axisLabelVisible: true,
      title: 'Exit',
    });

    const fetchCandles = async () => {
      try {
        const symbol = `C:${trade.symbol.toUpperCase()}`;
        const from = new Date((trade.entry_time - 3600) * 1000).toISOString().split('T')[0];
        const to = new Date((trade.exit_time + 3600) * 1000).toISOString().split('T')[0];

        const apiKey = process.env.NEXT_PUBLIC_POLYGON_API_KEY || 'demo';

        const res = await fetch(
          `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/minute/${from}/${to}?adjusted=true&sort=asc&apiKey=${apiKey}`
        );

        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const candles = data.results.map((r: any) => ({
              time: Math.floor(r.t / 1000),
              open: r.o,
              high: r.h,
              low: r.l,
              close: r.c,
            }));

            candlestickSeries.setData(candles);
            chart.timeScale().fitContent();
            setApiError(null);
          } else {
            setApiError('API limit reached or No data found');
          }
        } else {
          setApiError('API limit reached or No data found');
        }
      } catch (err) {
        console.error('Failed to fetch candles:', err);
        setApiError('API limit reached or No data found');
      }
    };

    fetchCandles();

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: isFullscreen ? window.innerHeight : 600,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [trade, isFullscreen]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-500" />
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 flex-col gap-4">
        <p className="text-slate-400 text-lg">No trade data found</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const mainContentClasses = isFullscreen
    ? 'fixed inset-0 z-50 bg-slate-950'
    : 'flex flex-col min-h-screen bg-slate-950 text-slate-100';

  return (
    <div className={isFullscreen ? '' : 'flex flex-col min-h-screen bg-slate-950 text-slate-100'}>
      <div className={isFullscreen ? 'h-full' : 'flex-1'}>
        <div className="relative w-full h-full">
          <button
            onClick={() => router.push('/dashboard')}
            className="absolute top-4 left-4 z-20 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <button
            onClick={toggleFullscreen}
            className="absolute top-4 right-4 z-20 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            {isFullscreen ? (
              <Minimize2 className="h-5 w-5" />
            ) : (
              <Maximize2 className="h-5 w-5" />
            )}
          </button>

          {apiError && (
            <div className="absolute top-12 left-12 bg-slate-800 text-amber-400 px-4 py-2 rounded-lg z-10">
              {apiError}
            </div>
          )}

          <div
            ref={chartContainerRef}
            className={`w-full ${isFullscreen ? 'h-full' : 'min-h-[600px]'}`}
          />
        </div>
      </div>

      {!isFullscreen && (
        <div className="bg-slate-900/50 border-t border-slate-800 p-6">
          <div className="grid grid-cols-5 gap-8">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-slate-400 mb-3">
                <DollarSign className="h-4 w-4" />
                <span className="text-sm font-semibold uppercase tracking-wider">Price</span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-500">Type</span>
                  <p className={`text-lg font-mono ${String(trade.type).toLowerCase().includes('buy') ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {trade.type}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Open Price</span>
                  <p className="text-lg font-mono text-slate-200">{trade.entry_price}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Close Price</span>
                  <p className="text-lg font-mono text-slate-200">{trade.exit_price}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-slate-400 mb-3">
                <Shield className="h-4 w-4" />
                <span className="text-sm font-semibold uppercase tracking-wider">Trade Protection</span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-500">SL</span>
                  <p className="text-lg font-mono text-slate-400">-</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">SL Pips</span>
                  <p className="text-lg font-mono text-slate-400">-</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">TP</span>
                  <p className="text-lg font-mono text-slate-400">-</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">TP Pips</span>
                  <p className="text-lg font-mono text-slate-400">-</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-slate-400 mb-3">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm font-semibold uppercase tracking-wider">Results</span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-500">Gross Profit</span>
                  <p className={`text-lg font-mono ${parseFloat(String(trade.profit).replace(/[^-0-9.]/g, '')) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {trade.profit}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Swap</span>
                  <p className="text-lg font-mono text-slate-500">{trade.swap}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Commission</span>
                  <p className="text-lg font-mono text-slate-500">{trade.commission}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Net Profit</span>
                  <p className={`text-lg font-mono ${parseFloat(String(trade.net_profit).replace(/[^-0-9.]/g, '')) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {trade.net_profit}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-slate-400 mb-3">
                <Clock className="h-4 w-4" />
                <span className="text-sm font-semibold uppercase tracking-wider">Time</span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-500">Open Time</span>
                  <p className="text-lg font-mono text-slate-200">{formatDateTime(trade.entry_time)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Close Time</span>
                  <p className="text-lg font-mono text-slate-200">{formatDateTime(trade.exit_time)}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-slate-400 mb-3">
                <BarChart2 className="h-4 w-4" />
                <span className="text-sm font-semibold uppercase tracking-wider">Statistics</span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-500">Symbol</span>
                  <p className="text-lg font-mono text-slate-200">{trade.symbol}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Volume</span>
                  <p className="text-lg font-mono text-slate-200">{trade.volume}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
