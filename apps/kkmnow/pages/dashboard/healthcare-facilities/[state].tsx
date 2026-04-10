import { useTranslation } from "datagovmy-ui/hooks";
import { Page } from "datagovmy-ui/types";
import { InferGetStaticPropsType, GetStaticProps, GetStaticPaths } from "next";
import Layout from "@components/Layout";
import { Metadata, StateDropdown, StateModal } from "datagovmy-ui/components";
import { CountryAndStates, STATE_CODES } from "datagovmy-ui/constants";
import { withi18n } from "datagovmy-ui/decorators";
import { get } from "datagovmy-ui/api";
import { routes } from "@lib/routes";
import { ISR_REVALIDATE } from "@lib/constants";
import HealthcareFacilitiesDashboard from "@dashboards/healthcare-facilities";
import { WindowProvider } from "datagovmy-ui/contexts/window";
import { AnalyticsProvider } from "datagovmy-ui/contexts/analytics";

const HealthcareFacilitiesState: Page = ({
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
      <Metadata
        title={CountryAndStates[params.state].concat(" - ", t("header"))}
        description={t("description")}
        keywords=""
      />
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

HealthcareFacilitiesState.layout = (page, props) => (
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
      <StateModal state={props.params.state} url={routes.FACILITIES} />
      {page}
    </Layout>
  </WindowProvider>
);

// Build at runtime
export const getStaticPaths: GetStaticPaths = () => {
  return {
    paths: [],
    fallback: "blocking",
  };
};

export const getStaticProps: GetStaticProps = withi18n(
  ["dashboard-healthcare-facilities", "common"],
  async ({ params }) => {
    const curr_state_code = String(params.state);

    // Validate param
    if (!STATE_CODES.includes(curr_state_code)) {
      return { notFound: true };
    }

    const { data } = await get(
      `/dashboards/healthcare-facilities-${curr_state_code}.json`,
      {},
      "api_s3"
    );

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
        params: params,
        overview: data.overview,
        choropleth: data.choropleth_facility,
        bar_type: data.bar_type,
      },
      revalidate: ISR_REVALIDATE,
    };
  }
);

export default HealthcareFacilitiesState;
