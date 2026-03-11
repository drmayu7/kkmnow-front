import { routes } from "@lib/routes";
import {
  AgencyBadge,
  Container,
  Hero,
  LeftRightCard,
  RankList,
  Section,
  StateDropdown,
  Tabs,
} from "datagovmy-ui/components";
import { CountryAndStates } from "datagovmy-ui/constants";
import { numFormat, toDate } from "datagovmy-ui/helpers";
import { useData, useTranslation } from "datagovmy-ui/hooks";
import dynamic from "next/dynamic";
import { FunctionComponent, useEffect, useState } from "react";

const Choropleth = dynamic(() => import("datagovmy-ui/charts/choropleth"), { ssr: false });
const MapPlot = dynamic(() => import("datagovmy-ui/charts/map-plot"), { ssr: false });
const BarMeter = dynamic(() => import("datagovmy-ui/charts/bar-meter"), { ssr: false });

interface MapMarker {
  position: [number, number];
  tooltip: Record<string, string>;
}

interface HealthcareFacilitiesProps {
  last_updated: string;
  next_update: string;
  params: { state: string };
  overview: {
    total: number;
    hospital: number;
    clinic: number;
    dental: number;
    admin: number;
    other: number;
  };
  choropleth: {
    data_as_of: string;
    data: { x: string[]; y: Record<string, number[]> };
  };
  bar_type: {
    data_as_of: string;
    data: Array<{ x: string; y: number }>;
  };
}

/** State centroids for map zoom */
const STATE_CENTROIDS: Record<string, [number, number]> = {
  jhr: [2.0, 103.5],
  kdh: [6.1, 100.7],
  ktn: [5.3, 102.1],
  mlk: [2.2, 102.3],
  nsn: [2.7, 102.0],
  phg: [3.8, 102.4],
  prk: [4.6, 101.1],
  pls: [6.5, 100.2],
  png: [5.4, 100.3],
  sbh: [5.3, 117.0],
  swk: [2.5, 111.5],
  sgr: [3.3, 101.5],
  trg: [4.9, 103.1],
  kul: [3.14, 101.69],
  lbn: [5.28, 115.24],
  pjy: [2.93, 101.69],
};

const CHORO_FILTER_KEYS = ["total", "hospital", "clinic", "dental"] as const;

const HealthcareFacilitiesDashboard: FunctionComponent<HealthcareFacilitiesProps> = ({
  params,
  last_updated,
  next_update,
  overview,
  choropleth,
  bar_type,
}) => {
  const { t, i18n } = useTranslation(["dashboard-healthcare-facilities", "common"]);
  const { data, setData } = useData({ choro_tab: 0 });
  const [mapMarkers, setMapMarkers] = useState<MapMarker[]>([]);
  const [markersLoading, setMarkersLoading] = useState(true);

  useEffect(() => {
    const stateCode = params.state;
    const url = `${process.env.NEXT_PUBLIC_S3_URL}/dashboards/healthcare-facilities-${stateCode}.json`;

    fetch(url)
      .then(res => res.json())
      .then(json => {
        setMapMarkers(json.map_markers ?? []);
      })
      .catch(() => {
        setMapMarkers([]);
      })
      .finally(() => setMarkersLoading(false));
  }, [params.state]);

  const isNational = params.state === "mys";
  const mapPosition: [number, number] = isNational
    ? [4.5, 109.5]
    : STATE_CENTROIDS[params.state] ?? [4.5, 109.5];
  const mapZoom = isNational ? 6 : 8;

  const statCards = [
    { key: "overview_total", value: overview.total, color: "bg-primary dark:bg-primary-dark" },
    { key: "overview_hospital", value: overview.hospital, color: "bg-green-600" },
    { key: "overview_clinic", value: overview.clinic, color: "bg-blue-600" },
    { key: "overview_dental", value: overview.dental, color: "bg-purple-600" },
    { key: "overview_admin", value: overview.admin + overview.other, color: "bg-slate-500" },
  ];

  const activeChoroKey = CHORO_FILTER_KEYS[data.choro_tab] ?? "total";

  return (
    <>
      <Hero
        background="green"
        category={[t("common:categories.healthcare"), "text-green"]}
        header={[t("header")]}
        description={[t("description")]}
        action={
          <StateDropdown url={routes.FACILITIES} currentState={params.state} />
        }
        last_updated={last_updated}
        next_update={next_update}
        agencyBadge={<AgencyBadge agency="pik" />}
      />

      <Container className="min-h-screen">
        {/* Section 1: Key Stats Overview */}
        <Section
          title={t("overview_header", { state: CountryAndStates[params.state] })}
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {statCards.map(({ key, value, color }) => (
              <div
                key={key}
                className="border-outline dark:border-washed-dark flex flex-col gap-2 rounded-xl border p-4"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                  <p className="text-dim text-sm font-medium">{t(key)}</p>
                </div>
                <p className="text-2xl font-bold">{numFormat(value, "standard", 0)}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Section 2: State Distribution (Choropleth) */}
        <Section>
          <LeftRightCard
            left={
              <div className="flex h-[600px] w-full flex-col overflow-hidden p-6 lg:p-8">
                <div className="space-y-6 pb-6">
                  <div className="flex flex-col gap-2">
                    <h4>{t("choro_header")}</h4>
                    <span className="text-dim text-sm">
                      {t("common:common.data_of", {
                        date: toDate(
                          choropleth.data_as_of,
                          "dd MMM yyyy, HH:mm",
                          i18n.language
                        ),
                      })}
                    </span>
                  </div>
                  <p className="text-dim whitespace-pre-line">{t("choro_desc")}</p>
                  <Tabs.List
                    options={CHORO_FILTER_KEYS.map(k => t(`filter_${k}`))}
                    current={data.choro_tab}
                    onChange={(index: number) => setData("choro_tab", index)}
                  />
                </div>
                <RankList
                  id="facilities-by-state"
                  title={t("common:common.ranking", {
                    count: choropleth.data.x.length,
                  })}
                  data={choropleth.data.y[activeChoroKey]}
                  color="text-green-600"
                  threshold={choropleth.data.x.length}
                  format={(position: number) => ({
                    label: CountryAndStates[choropleth.data.x[position]],
                    value: numFormat(
                      choropleth.data.y[activeChoroKey][position],
                      "standard",
                      0
                    ),
                  })}
                />
              </div>
            }
            right={
              <Choropleth
                id="choropleth-facilities"
                className="h-[400px] w-auto rounded-b lg:h-[500px] lg:w-full"
                color="greens"
                data={{
                  labels: choropleth.data.x.map(
                    (state: string) => CountryAndStates[state]
                  ),
                  values: choropleth.data.y[activeChoroKey],
                }}
                type="state"
              />
            }
          />
        </Section>

        {/* Section 3: Facility Map */}
        <Section
          title={t("map_header")}
          description={t("map_desc", {
            count: markersLoading ? "—" : numFormat(mapMarkers.length, "standard", 0),
            total: numFormat(overview.total, "standard", 0),
          })}
        >
          {markersLoading ? (
            <div className="border-outline dark:border-washed-dark flex h-[500px] w-full items-center justify-center rounded-xl border">
              <p className="text-dim animate-pulse text-sm">{t("common:common.loading")}</p>
            </div>
          ) : (
            <MapPlot
              className="h-[500px] w-full rounded-xl"
              position={mapPosition}
              zoom={mapZoom}
              markers={mapMarkers}
            />
          )}
        </Section>

        {/* Section 4: Type Breakdown */}
        <Section
          title={t("bartype_header")}
          description={t("bartype_desc")}
          date={bar_type.data_as_of}
        >
          <BarMeter
            className="max-w-2xl"
            data={bar_type.data}
            layout="horizontal"
            sort="desc"
            relative
          />
        </Section>
      </Container>
    </>
  );
};

export default HealthcareFacilitiesDashboard;
