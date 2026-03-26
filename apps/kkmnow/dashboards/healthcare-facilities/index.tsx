import { routes } from "@lib/routes";
import {
  BuildingOffice2Icon,
  BuildingOfficeIcon,
  HomeModernIcon,
} from "@heroicons/react/20/solid";
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
import { ToothIcon } from "datagovmy-ui/icons/kkmnow";
import dynamic from "next/dynamic";
import { FunctionComponent, ReactNode } from "react";

const Choropleth = dynamic(() => import("datagovmy-ui/charts/choropleth"), { ssr: false });
const BarMeter = dynamic(() => import("datagovmy-ui/charts/bar-meter"), { ssr: false });

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
  const { data, setData } = useData({ choro_tab: 0, showAllTypes: false });

  const statCards: Array<{
    key: string;
    value: number;
    color: string;
    icon?: ReactNode;
  }> = [
    { key: "overview_total", value: overview.total, color: "bg-primary dark:bg-primary-dark" },
    { key: "overview_hospital", value: overview.hospital, color: "text-green-600", icon: <BuildingOffice2Icon className="h-5 w-5" /> },
    { key: "overview_clinic", value: overview.clinic, color: "text-blue-600", icon: <HomeModernIcon className="h-5 w-5" /> },
    { key: "overview_dental", value: overview.dental, color: "text-purple-600", icon: <ToothIcon className="h-5 w-5" /> },
    { key: "overview_admin", value: overview.admin + overview.other, color: "text-slate-500", icon: <BuildingOfficeIcon className="h-5 w-5" /> },
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
            {statCards.map(({ key, value, color, icon }) => (
              <div
                key={key}
                className={`border-outline dark:border-washed-dark flex flex-col gap-2 rounded-xl border p-4 ${
                  key === "overview_total" ? "bg-slate-50 dark:bg-[#1c2230]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {icon ? (
                    <span className={color}>{icon}</span>
                  ) : (
                    <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                  )}
                  <p className="text-dim text-sm font-medium">{t(key)}</p>
                </div>
                <p className={key === "overview_total" ? "text-3xl font-bold" : "text-2xl font-bold"}>
                  {numFormat(value, "standard", 0)}
                </p>
                {key !== "overview_total" && (
                  <p className="text-dim text-xs">
                    {((value / overview.total) * 100).toFixed(1)}% {t("of_total")}
                  </p>
                )}
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

        {/* Section 3: Type Breakdown */}
        <Section
          title={t("bartype_header")}
          description={t("bartype_desc")}
          date={bar_type.data_as_of}
        >
          <BarMeter
            className="max-w-2xl"
            data={data.showAllTypes ? bar_type.data : bar_type.data.slice(0, 10)}
            layout="horizontal"
            sort="desc"
            relative
            precision={0}
          />
          {bar_type.data.length > 10 && (
            <button
              className="text-primary mt-4 text-sm font-medium hover:underline"
              onClick={() => setData("showAllTypes", !data.showAllTypes)}
            >
              {data.showAllTypes ? t("show_less") : t("show_all", { count: bar_type.data.length })}
            </button>
          )}
        </Section>
      </Container>
    </>
  );
};

export default HealthcareFacilitiesDashboard;
