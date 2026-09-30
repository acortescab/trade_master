"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePriceStream } from "@/hooks/usePriceStream";
import { api } from "@/lib/api";
import { livePortfolio } from "@/lib/portfolio";
import type { Portfolio, Snapshot, TradeSide, WatchlistItem } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import { Header } from "./Header";
import { Heatmap } from "./Heatmap";
import { MainChart } from "./MainChart";
import { Panel } from "./Panel";
import { PnlChart } from "./PnlChart";
import { PositionsTable } from "./PositionsTable";
import { TradeBar } from "./TradeBar";
import { Watchlist, type WatchRow } from "./Watchlist";

const HISTORY_REFRESH_MS = 30_000;
const EMPTY: never[] = [];

export function Workstation() {
  const stream = usePriceStream();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Chat docks beside the terminal on wide screens and overlays as a drawer below that.
  const isWide = useMediaQuery("(min-width: 1280px)");
  const [chatPref, setChatPref] = useState<boolean | null>(null);
  const chatOpen = chatPref ?? isWide;

  const refreshPortfolio = useCallback(
    () =>
      api
        .portfolio()
        .then((p) => {
          setPortfolio(p);
          setLoadError(null);
        })
        .catch((e: Error) => setLoadError(e.message)),
    [],
  );
  const refreshWatchlist = useCallback(
    () => api.watchlist().then(setWatchlist).catch((e: Error) => setLoadError(e.message)),
    [],
  );
  const refreshHistory = useCallback(() => api.history(24).then(setSnapshots).catch(() => undefined), []);
  const refreshAll = useCallback(() => {
    void refreshPortfolio();
    void refreshWatchlist();
  }, [refreshPortfolio, refreshWatchlist]);

  useEffect(() => {
    refreshAll();
    void refreshHistory();
    const timer = setInterval(refreshHistory, HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshAll, refreshHistory]);

  const { prices, history, status } = stream;
  const streaming = Object.keys(prices).length > 0;

  const rows: WatchRow[] = useMemo(
    () =>
      watchlist.map((w) => {
        const live = prices[w.ticker];
        // Once the stream is flowing, a ticker absent from it is untracked/unpriced.
        return {
          ticker: w.ticker,
          price: live?.price ?? (streaming ? null : w.price),
          sessionOpen: live?.session_open ?? (streaming ? null : w.session_open),
          history: history[w.ticker] ?? EMPTY,
        };
      }),
    [watchlist, prices, history, streaming],
  );

  const live = useMemo(() => (portfolio ? livePortfolio(portfolio, prices) : null), [portfolio, prices]);

  const activeTicker = selected ?? watchlist[0]?.ticker ?? null;
  const activeLive = activeTicker ? prices[activeTicker] : undefined;
  const activeItem = watchlist.find((w) => w.ticker === activeTicker);
  const activePosition = live?.positions.find((p) => p.ticker === activeTicker);

  const onAdd = useCallback(
    async (ticker: string) => {
      const item = await api.addTicker(ticker);
      setSelected(item.ticker);
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  const onRemove = useCallback(
    async (ticker: string) => {
      await api.removeTicker(ticker);
      setSelected((s) => (s === ticker ? null : s));
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  const onTrade = useCallback(
    async (ticker: string, side: TradeSide, quantity: number) => {
      const result = await api.trade(ticker, side, quantity);
      refreshAll();
      return result;
    },
    [refreshAll],
  );

  const toggleChat = () => setChatPref(!chatOpen);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        totalValue={live?.totalValue ?? null}
        cash={live?.cash ?? null}
        unrealizedPnl={live?.unrealizedPnl ?? null}
        realizedPnl={live?.realizedPnl ?? null}
        status={status}
        chatOpen={chatOpen}
        onToggleChat={toggleChat}
      />
      {loadError && (
        <p role="alert" className="border-b border-down/40 bg-down/10 px-4 py-1.5 text-[13px] text-down">
          {loadError}
        </p>
      )}

      <main className="relative flex min-h-0 flex-1 gap-1 p-1 max-lg:flex-col max-lg:overflow-y-auto">
        <div className="shrink-0 lg:w-[330px] max-lg:h-[380px]">
          <Watchlist
            rows={rows}
            selected={activeTicker}
            onSelect={setSelected}
            onAdd={onAdd}
            onRemove={onRemove}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="min-h-[220px] flex-[5] max-lg:h-[340px] max-lg:flex-none">
            <MainChart
              ticker={activeTicker}
              history={activeTicker ? (history[activeTicker] ?? EMPTY) : EMPTY}
              price={activeLive?.price ?? activePosition?.price ?? activeItem?.price ?? null}
              sessionOpen={activeLive?.session_open ?? activeItem?.session_open ?? null}
            />
          </div>
          <div className="grid min-h-[180px] flex-[4] grid-cols-2 gap-1 max-md:grid-cols-1 max-lg:flex-none max-lg:auto-rows-[260px]">
            <Heatmap positions={live?.positions ?? EMPTY} onSelect={setSelected} />
            <PnlChart snapshots={snapshots} />
          </div>
          <Panel
            title="Positions"
            className="min-h-[170px] flex-[3] max-lg:flex-none"
            bodyClassName="flex flex-col"
            aside={
              live && (
                <span className="num text-[11px] text-ink-3">
                  {live.positions.length} open
                </span>
              )
            }
          >
            <div className="min-h-0 flex-1 overflow-auto">
              <PositionsTable positions={live?.positions ?? EMPTY} selected={activeTicker} onSelect={setSelected} />
            </div>
            <TradeBar selected={activeTicker} onTrade={onTrade} />
          </Panel>
        </div>

        <div
          className={`shrink-0 ${
            isWide
              ? "w-[360px]"
              : "fixed inset-y-0 right-0 z-30 w-[min(400px,100vw)] p-1 shadow-[-12px_0_32px_rgba(0,0,0,0.45)]"
          } ${chatOpen ? "" : "hidden"}`}
        >
          <ChatPanel onActions={refreshAll} onClose={isWide ? undefined : () => setChatPref(false)} />
        </div>
      </main>
    </div>
  );
}
