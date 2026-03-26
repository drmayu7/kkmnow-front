import { GetStaticProps, InferGetStaticPropsType } from "next";
import { get } from "datagovmy-ui/api";
import { useTranslation } from "datagovmy-ui/hooks";
import { WindowProvider } from "datagovmy-ui/contexts/window";
import { withi18n } from "datagovmy-ui/decorators";
import HealthcareFacilitiesDashboard from "@dashboards/healthcare-facilities";
import { Page } from "datagovmy-ui/types";
import Layout from "@components/Layout";
import { Metadata, StateDropdown, StateModal } from "datagovmy-ui/components";
import { routes } from "@lib/routes";
import { AnalyticsProvider } from "datagovmy-ui/contexts/analytics";

const HealthcareFacilities: Page = ({
  meta,
  last_updated,
  next_update,
  params,
  overview,
  choropleth,
  bar_type,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const { t } = useTranslation(["dashboard-healthcare-facilities", "common"]);

  return (
    <AnalyticsProvider meta={meta}>
      <Metadata title={t("header")} description={t("description")} keywords="" />
      <HealthcareFacilitiesDashboard
        last_updated={last_updated}
        next_update={next_update}
        params={params}
        overview={overview}
        choropleth={choropleth}
        bar_type={bar_type}
      />
    </AnalyticsProvider>
  );
};

HealthcareFacilities.layout = (page, props) => (
  <WindowProvider>
    <Layout
      stateSelector={
        <StateDropdown
          width="w-max xl:w-64"
          url={routes.FACILITIES}
          currentState={props.params.state}
          hideOnScroll
        />
      }
    >
      <StateModal url={routes.FACILITIES} state={props.params.state} />
      {page}
    </Layout>
  </WindowProvider>
);

export const getStaticProps: GetStaticProps = withi18n(
  ["dashboard-healthcare-facilities", "common"],
  async () => {
    const { data } = await get("/dashboards/healthcare-facilities-mys.json", {}, "api_s3");

    return {
      notFound: false,
      props: {
        meta: {
          id: "dashboard-healthcare-facilities",
          type: "dashboard",
          category: "healthcare",
          agency: "PIK",
        },
        last_updated: data.data_last_updated,
        next_update: data.data_next_update,
        params: { state: "mys" },
        overview: data.overview,
        choropleth: data.choropleth_facility,
        bar_type: data.bar_type,
      },
      revalidate: 60 * 60 * 24, // 1 day
    };
  }
);

export default HealthcareFacilities;
