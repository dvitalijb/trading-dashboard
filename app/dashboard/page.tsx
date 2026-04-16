'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/src/lib/firebase';
import LogoutButton from '@/src/components/LogoutButton';
import { 
  FileCode, 
  Save, 
  AlertCircle, 
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  Plus,
  Trash2,
  X,
  Sparkles
} from 'lucide-react';

interface Trade {
  position_id: number;
  symbol: string;
  type: string;
  entry_price: number;
  exit_price: number;
  profit: number;
  commission: number;
  swap: number;
  net_profit: number;
  entry_time: number;
  exit_time: number;
  volume: number;
  ticket?: number;
  magic?: number;
  comment?: string;
  isNew?: boolean;
}

interface AccountInfo {
  account: number;
  count: number;
}

interface Metrics {
  totalNetProfit: number;
  profitFactor: number;
  maximalDrawdown: number;
}

const formatDate = (timestamp: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const parseHTMLFile = (content: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');

  const allRows = Array.from(doc.querySelectorAll('tr'));
  let startIdx = -1;
  let endIdx = allRows.length;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const bTags = row.querySelectorAll('b');
    for (const b of bTags) {
      const bText = b.textContent?.trim().toLowerCase() || '';
      if (bText.includes('positions') && startIdx === -1) {
        startIdx = i;
      } else if (bText.includes('orders') && startIdx !== -1) {
        endIdx = i;
        break;
      }
    }
    if (startIdx !== -1 && endIdx !== allRows.length) break;
  }

  if (startIdx === -1) {
    throw new Error('Could not find Positions section in the HTML file');
  }

  const rows = allRows.slice(startIdx, endIdx);

  const parseNumber = (numStr: string): number => {
    if (!numStr) return 0;
    let cleaned = numStr.replace(/&nbsp;/g, '').replace(/\s/g, '');
    cleaned = cleaned.replace(/[^0-9.-]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  const parseTime = (timeStr: string): number => {
    if (!timeStr) return Date.now() / 1000;
    try {
      let dateStr = timeStr.replace(/&nbsp;/g, '').trim();
      dateStr = dateStr.replace(/\./g, '-');
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return Math.floor(date.getTime() / 1000);
      }
    } catch {
      // ignore
    }
    return Date.now() / 1000;
  };

  const parseType = (typeStr: string): string => {
    const s = typeStr.toLowerCase().trim();
    if (s.includes('buy') || s.includes('купити') || s === '0') return 'buy';
    if (s.includes('sell') || s.includes('продати') || s === '1') return 'sell';
    return s;
  };

  const trades: Trade[] = [];

  for (let i = 2; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td'))
  .filter(cell => {
    const isHidden = cell.classList.contains('hidden');
    const isSpacer = cell.getAttribute('colspan') === '8' && !cell.textContent?.trim();
    return !isHidden && !isSpacer;
  })
  .map(cell => cell.textContent?.trim() || '');

    if (cells.length < 13) continue;

    const positionIdStr = cells[1]?.replace(/&nbsp;/g, '').trim() || '';
    const positionId = parseNumber(positionIdStr);

    if (positionId === 0 && !positionIdStr.includes('0')) continue;

    const profit = parseNumber(cells[12]);
    const commission = parseNumber(cells[10]);
    const swap = parseNumber(cells[11]);
    const netProfit = profit + commission + swap;

    const trade: Trade = {
      position_id: positionId,
      symbol: cells[2]?.replace(/&nbsp;/g, '').trim() || '',
      type: parseType(cells[3]),
      volume: parseNumber(cells[4]),
      entry_price: parseNumber(cells[5]),
      exit_price: parseNumber(cells[9]),
      profit: profit,
      commission: commission,
      swap: swap,
      net_profit: netProfit,
      entry_time: parseTime(cells[0]),
      exit_time: parseTime(cells[8]),
      ticket: positionId
    };

    if (!trade.symbol) continue;

    trades.push(trade);
  }

  console.log('Parsed Positions:', trades);
  console.log('Number of trades:', trades.length);

  let metrics: Metrics = {
    totalNetProfit: 0,
    profitFactor: 0,
    maximalDrawdown: 0
  };

  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const text = table.textContent?.toLowerCase() || '';
    if (text.includes('total net profit') && (text.includes('profit factor') || text.includes('maximal drawdown'))) {
      const metricRows = Array.from(table.querySelectorAll('tr'));
      for (const row of metricRows) {
        const cells = Array.from(row.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
        const rowText = cells.join(' ').toLowerCase();

        if (rowText.includes('total net profit')) {
          metrics.totalNetProfit = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('profit factor')) {
          metrics.profitFactor = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('maximal drawdown')) {
          metrics.maximalDrawdown = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        }
      }
      break;
    }
  }

  return { trades, metrics };
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [status, setStatus] = useState('');
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [newlyLoadedTrades, setNewlyLoadedTrades] = useState<Trade[]>([]);
  const [newlyLoadedMetrics, setNewlyLoadedMetrics] = useState<Metrics | null>(null);
  const router = useRouter();

  const { newTrades, existingTradesCount, newTradesCount } = useMemo(() => {
    if (newlyLoadedTrades.length === 0) {
      return { newTrades: [], existingTradesCount: 0, newTradesCount: 0 };
    }

    const existingIds = new Set(trades.map(t => t.position_id));
    const newTrades: Trade[] = [];
    let existingCount = 0;

    for (const trade of newlyLoadedTrades) {
      if (existingIds.has(trade.position_id)) {
        existingCount++;
      } else {
        newTrades.push({ ...trade, isNew: true });
      }
    }

    return { 
      newTrades, 
      existingTradesCount: existingCount, 
      newTradesCount: newTrades.length 
    };
  }, [newlyLoadedTrades, trades]);

  const combinedTrades = useMemo(() => {
    if (newlyLoadedTrades.length === 0) {
      return trades;
    }

    const existingIds = new Set(trades.map(t => t.position_id));
    const result = [...trades];

    for (const trade of newlyLoadedTrades) {
      if (!existingIds.has(trade.position_id)) {
        result.push({ ...trade, isNew: true });
      }
    }

    return result;
  }, [newlyLoadedTrades, trades]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      setUser(currentUser);

      try {
        const docRef = doc(db, 'users', currentUser.uid, 'trades', 'data');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.trades) {
            setTrades(data.trades);
            setStatus('Showing saved data from Cloud');
          }
          if (data.account && data.count) {
            setAccountInfo({ account: data.account, count: data.count });
          }
          if (data.metrics) {
            setMetrics(data.metrics);
          }
        }
      } catch (err) {
        console.error('Error loading saved data:', err);
      }
      
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  const handleFileUpload = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.html') && !file.name.toLowerCase().endsWith('.htm')) {
      setError('Please upload a valid HTML file');
      return;
    }

    setProcessing(true);
    setError('');
    setSuccess('');
    setStatus('');

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const { trades: parsedTrades, metrics: parsedMetrics } = parseHTMLFile(content);
        
        if (parsedTrades.length === 0) {
          throw new Error('No trades found in the file');
        }

        const existingIds = new Set(trades.map(t => t.position_id));
        let tempExistingCount = 0;
        let tempNewCount = 0;

        for (const trade of parsedTrades) {
          if (existingIds.has(trade.position_id)) {
            tempExistingCount++;
          } else {
            tempNewCount++;
          }
        }

        setNewlyLoadedTrades(parsedTrades);
        setNewlyLoadedMetrics(parsedMetrics);
        setStatus(`Found ${tempNewCount} new trades, ${tempExistingCount} existing will be skipped`);
        setSuccess(`File loaded successfully! Review the changes below.`);
        setProcessing(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setProcessing(false);
    };

    reader.readAsText(file);
  }, [trades]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  }, [handleFileUpload]);

  const handleAddNewOnly = async () => {
    if (!user) return;

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const batch = writeBatch(db);
      const docRef = doc(db, 'users', user.uid, 'trades', 'data');
      
      const allTrades = [...trades, ...newTrades];
      
      batch.set(docRef, {
        trades: allTrades,
        account: accountInfo?.account || 0,
        count: allTrades.length,
        metrics: newlyLoadedMetrics || metrics,
        updatedAt: new Date()
      }, { merge: true });

      await batch.commit();

      setTrades(allTrades);
      setAccountInfo({ account: 0, count: allTrades.length });
      setMetrics(newlyLoadedMetrics || metrics);
      setNewlyLoadedTrades([]);
      setNewlyLoadedMetrics(null);
      setSuccess(`Successfully added ${newTrades.length} new trades!`);
      setStatus('Showing saved data from Cloud');
    } catch (err: unknown) {
      setError(`Failed to sync: ${err instanceof Error ? err.message : 'An error occurred'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleOverwriteAll = async () => {
    if (!user) return;

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const batch = writeBatch(db);
      const docRef = doc(db, 'users', user.uid, 'trades', 'data');
      
      batch.set(docRef, {
        trades: newlyLoadedTrades,
        account: accountInfo?.account || 0,
        count: newlyLoadedTrades.length,
        metrics: newlyLoadedMetrics,
        updatedAt: new Date()
      });

      await batch.commit();

      setTrades(newlyLoadedTrades);
      setAccountInfo({ account: 0, count: newlyLoadedTrades.length });
      setMetrics(newlyLoadedMetrics);
      setNewlyLoadedTrades([]);
      setNewlyLoadedMetrics(null);
      setShowOverwriteConfirm(false);
      setSuccess(`Successfully overwritten with ${newlyLoadedTrades.length} trades!`);
      setStatus('Showing saved data from Cloud');
    } catch (err: unknown) {
      setError(`Failed to sync: ${err instanceof Error ? err.message : 'An error occurred'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setNewlyLoadedTrades([]);
    setNewlyLoadedMetrics(null);
    setStatus('Showing saved data from Cloud');
    setError('');
    setSuccess('');
  };

  const handleRowClick = (trade: Trade) => {
    localStorage.setItem(trade.position_id.toString(), JSON.stringify(trade));
    window.open(`/trade/${trade.position_id}`, '_blank');
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-500" />
      </div>
    );
  }

  const fileLoaded = newlyLoadedTrades.length > 0;
  const hasSavedData = trades.length > 0 && !fileLoaded;
  const displayTrades = fileLoaded ? combinedTrades : trades;

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-emerald-400 tracking-tight">Trading Journal</h1>
          {status && (
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium">
              {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm font-medium text-slate-400 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700">
              {user.email}
            </span>
          )}
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Stats Cards - Only show when data exists */}
          {(hasSavedData || fileLoaded) && metrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-xl bg-emerald-500/10">
                    <TrendingUp className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Total Net Profit</h3>
                </div>
                <p className={`text-3xl font-bold ${metrics.totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {metrics.totalNetProfit >= 0 ? '+' : ''}{metrics.totalNetProfit.toFixed(2)}
                </p>
              </div>

              <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-xl bg-blue-500/10">
                    <Target className="h-6 w-6 text-blue-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Profit Factor</h3>
                </div>
                <p className={`text-3xl font-bold ${metrics.profitFactor >= 1.5 ? 'text-emerald-400' : metrics.profitFactor >= 1.0 ? 'text-yellow-400' : 'text-rose-400'}`}>
                  {metrics.profitFactor.toFixed(2)}
                </p>
              </div>

              <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-xl bg-rose-500/10">
                    <TrendingDown className="h-6 w-6 text-rose-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Maximal Drawdown</h3>
                </div>
                <p className="text-3xl font-bold text-rose-400">
                  {metrics.maximalDrawdown.toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {fileLoaded && (
            <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-slate-100">
                    Found <span className="text-emerald-400 font-bold">{newTradesCount}</span> new trades,{' '}
                    <span className="text-slate-400 font-bold">{existingTradesCount}</span> existing will be skipped
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  
                  <button
                    onClick={handleAddNewOnly}
                    disabled={uploading}
                    className="flex items-center gap-2 px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add New Only
                  </button>
                  
                  <button
                    onClick={() => setShowOverwriteConfirm(true)}
                    disabled={uploading}
                    className="flex items-center gap-2 px-6 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-all disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Overwrite All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Header Controls - Only show when not in merge mode */}
          {!fileLoaded && hasSavedData && (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                {accountInfo && (
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Trades</span>
                      <span className="text-lg font-bold text-emerald-400 font-mono">{accountInfo.count}</span>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => document.getElementById('file-input')?.click()}
                className="flex items-center gap-3 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all shadow-lg shadow-emerald-500/20"
              >
                <FileCode className="h-5 w-5" />
                Load New File
              </button>
            </div>
          )}

          {/* Messages */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-4 text-sm text-red-400 border border-red-500/20">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              {success}
            </div>
          )}

          {/* Upload Area - Only show when no file loaded and no saved data */}
          {!hasSavedData && !fileLoaded && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => document.getElementById('file-input')?.click()}
              className="flex flex-col items-center justify-center py-24 space-y-6 text-center border-2 border-dashed border-slate-700 rounded-2xl bg-slate-900/50 cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
            >
              <input
                id="file-input"
                type="file"
                accept=".html,.htm"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {processing ? (
                <>
                  <div className="h-24 w-24 rounded-3xl bg-slate-800 flex items-center justify-center border border-slate-700">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-slate-200 mb-2">Processing...</h3>
                    <p className="text-slate-500 max-w-md mx-auto">
                      Parsing your MetaTrader 5 HTML report.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-24 w-24 rounded-3xl bg-slate-900 flex items-center justify-center border border-slate-800">
                    <FileCode className="h-12 w-12 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-slate-200 mb-2">Upload MetaTrader 5 HTML Report</h3>
                    <p className="text-slate-500 max-w-md mx-auto">
                      Please upload your MT5 HTML report to see the statistics
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Trades Table */}
          {displayTrades.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
                <h3 className="text-lg font-semibold text-slate-100">Trade History</h3>
                {!fileLoaded && (
                  <button
                    onClick={() => document.getElementById('file-input')?.click()}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Load New File
                  </button>
                )}
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-slate-800 bg-slate-900/50 text-sm font-semibold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-4 w-16">Status</th>
                      <th className="px-4 py-4">Position ID</th>
                      <th className="px-4 py-4">Time (Open)</th>
                      <th className="px-4 py-4">Time (Close)</th>
                      <th className="px-4 py-4">Symbol</th>
                      <th className="px-4 py-4">Type</th>
                      <th className="px-4 py-4 text-right">Volume</th>
                      <th className="px-4 py-4 text-right">Entry Price</th>
                      <th className="px-4 py-4 text-right">Exit Price</th>
                      <th className="px-4 py-4 text-right text-xs">Commission</th>
                      <th className="px-4 py-4 text-right text-xs">Swap</th>
                      <th className="px-4 py-4 text-right text-xs">Net Profit</th>
                      <th className="px-4 py-4 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {displayTrades.map((trade) => (
                      <tr
                        key={trade.position_id}
                        onClick={() => handleRowClick(trade)}
                        className={`cursor-pointer transition-all ${
                          trade.isNew 
                            ? 'bg-emerald-500/5 hover:bg-emerald-500/10' 
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="px-4 py-4">
                          {trade.isNew && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase">
                              <Sparkles className="h-3 w-3" />
                              New
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 font-mono text-slate-400 text-sm">#{trade.position_id}</td>
                        <td className="px-4 py-4 text-slate-300 text-sm">
                          {formatDate(trade.entry_time)}
                        </td>
                        <td className="px-4 py-4 text-slate-300 text-sm">
                          {formatDate(trade.exit_time)}
                        </td>
                        <td className="px-4 py-4 font-medium text-slate-100">{trade.symbol}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                            trade.type?.toLowerCase().includes('buy')
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {trade.type}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right text-slate-300 font-mono text-sm">
                          {trade.volume?.toFixed(2) || '0.00'}
                        </td>
                        <td className="px-4 py-4 text-right text-slate-300 font-mono text-sm">
                          {trade.entry_price?.toFixed(5)}
                        </td>
                        <td className="px-4 py-4 text-right text-slate-300 font-mono text-sm">
                          {trade.exit_price?.toFixed(5)}
                        </td>
                        <td className="px-4 py-4 text-right text-slate-500 font-mono text-xs">
                          {trade.commission?.toFixed(2)}
                        </td>
                        <td className="px-4 py-4 text-right text-slate-500 font-mono text-xs">
                          {trade.swap?.toFixed(2)}
                        </td>
                        <td className={`px-4 py-4 text-right font-bold text-sm ${
                          trade.net_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {trade.net_profit >= 0 ? '+' : ''}{trade.net_profit?.toFixed(2)}
                        </td>
                        <td className={`px-4 py-4 text-right font-bold ${
                          trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {trade.profit >= 0 ? '+' : ''}{trade.profit?.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Overwrite Confirmation Modal */}
      {showOverwriteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between px-7 py-6 border-b border-slate-800">
              <h2 className="text-xl font-semibold text-slate-100">Confirm Overwrite</h2>
              <button
                onClick={() => setShowOverwriteConfirm(false)}
                className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="p-7 space-y-6">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertCircle className="h-6 w-6 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-rose-200">
                  This will delete all previous notes and data for this account. Are you sure?
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowOverwriteConfirm(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleOverwriteAll}
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-all disabled:opacity-50"
                >
                  {uploading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Trash2 className="h-5 w-5" />
                  )}
                  Overwrite All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for reload */}
      <input
        id="file-input-hidden"
        type="file"
        accept=".html,.htm"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
