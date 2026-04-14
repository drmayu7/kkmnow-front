import { MetaPage } from "../../types";
import {
  FunctionComponent,
  ReactNode,
  createContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/router";
import { get, post } from "../lib/api";

/**
 * Realtime view count for dashboard & data-catalogue.
 * Self-hosted analytics — replaces TinyBird.
 */

export type DownloadFileFormat = "svg" | "png" | "csv" | "parquet";

export type Meta = Omit<MetaPage["meta"], "type"> & { type: "dashboard" | "data-catalogue" };

type AnalyticsResult<T extends "dashboard" | "data-catalogue"> = {
  id: string;
  type: T;
  total_views: number;
  total_downloads: T extends "dashboard" ? never : number;
  download_csv: T extends "dashboard" ? never : number;
  download_parquet: T extends "dashboard" ? never : number;
  download_png: T extends "dashboard" ? never : number;
  download_svg: T extends "dashboard" ? never : number;
};

type AnalyticsContextProps<T extends "dashboard" | "data-catalogue"> = {
  result?: Partial<AnalyticsResult<T>>;
  realtime_track: (id: string, type: Meta["type"]) => void;
  update_download: T extends "dashboard" ? never : (id: string, format: DownloadFileFormat) => void;
  send_new_analytics: (
    id: string,
    type: "dashboard" | "data-catalogue" | "publication",
    pageEvent: "page_view" | "file_download",
    additionalData?: {
      format?: string;
      publication_id?: string;
      resource_id?: number;
    }
  ) => Promise<void>;
};

interface ContextChildren {
  meta: Meta;
  children: ReactNode;
}

export const AnalyticsContext = createContext<
  AnalyticsContextProps<"dashboard" | "data-catalogue">
>({
  result: {},
  realtime_track() {},
  update_download() {},
  send_new_analytics: async () => {},
});

export const AnalyticsProvider: FunctionComponent<ContextChildren> = ({ meta, children }) => {
  const [data, setData] = useState<AnalyticsResult<"dashboard" | "data-catalogue"> | undefined>();
  const router = useRouter();

  // Auto-increment view count on mount and route change
  useEffect(() => {
    track(meta.id, meta.type);
  }, [router.asPath]);

  const track = async (id: string, type: Meta["type"]) => {
    try {
      // Fire-and-forget: record the page view
      post("/analytics/event", {
        event_type: "page_view",
        page_id: id,
        page_type: type,
      }).catch(() => {}); // Silently ignore POST failures

      // Fetch updated counts
      if (type === "data-catalogue") {
        const response = await get(`/analytics/catalogue/${id}`);
        const result = response.data?.data;
        if (result) {
          setData({ id, type, ...result });
        }
      } else {
        const response = await get("/analytics/views", { page_type: type });
        const views = response.data?.data;
        if (views) {
          const match = views.find((item: any) => item.id === id && item.type === type);
          if (match) {
            setData({ ...match, id, type });
          }
        }
      }
    } catch (error) {
      console.error("Analytics track error:", error);
    }
  };

  const updateDownloadCount = async (id: string, format: DownloadFileFormat) => {
    try {
      await post("/analytics/event", {
        event_type: "file_download",
        page_id: id,
        page_type: "data-catalogue",
        download_format: format,
      });

      // Optimistically increment local state
      if (data) {
        setData({
          ...data,
          [`download_${format}`]: (data[`download_${format}`] ?? 0) + 1,
          total_downloads: (data.total_downloads ?? 0) + 1,
        } as any);
      }
    } catch (error) {
      console.error("Analytics download track error:", error);
    }
  };

  /**
   * Backward-compatible analytics call used by data-catalogue downloads
   * and publication modal downloads. Routes through the same /analytics/event
   * endpoint as update_download.
   */
  const sendNewAnalytics = async (
    id: string,
    type: "dashboard" | "data-catalogue" | "publication",
    pageEvent: "page_view" | "file_download",
    additionalData?: {
      format?: string;
      publication_id?: string;
      resource_id?: number;
    }
  ) => {
    try {
      // Map to the backend analytics event format
      const pageType = type === "publication" ? "data-catalogue" : type;
      const payload: any = {
        event_type: pageEvent,
        page_id: additionalData?.publication_id ?? id,
        page_type: pageType,
      };
      if (pageEvent === "file_download" && additionalData?.format) {
        payload.download_format = additionalData.format;
      }
      await post("/analytics/event", payload);
    } catch (error) {
      console.error("Analytics send error:", error);
    }
  };

  return (
    <AnalyticsContext.Provider
      value={{
        result: data,
        realtime_track: track,
        update_download: updateDownloadCount,
        send_new_analytics: sendNewAnalytics,
      }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
};
