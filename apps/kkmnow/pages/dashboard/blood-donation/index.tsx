import { GetStaticProps, InferGetStaticPropsType } from "next";
import { get } from "datagovmy-ui/api";
import { useTranslation } from "datagovmy-ui/hooks";
import { WindowProvider } from "datagovmy-ui/contexts/window";
import { withi18n } from "datagovmy-ui/decorators";
import BloodDonationDashboard from "@dashboards/blood-donation";
import { DateTime } from "luxon";
import { Page } from "datagovmy-ui/types";
import Layout from "@components/Layout";
import { Metadata, StateDropdown, StateModal } from "datagovmy-ui/components";
import { ISR_REVALIDATE } from "@lib/constants";
import { routes } from "@lib/routes";
import { AnalyticsProvider } from "datagovmy-ui/contexts/analytics";

const BloodDonation: Page = ({
  meta,
  last_updated,
  next_update,
  params,
  timeseries,
  barchart_age,
  barchart_time,
  barchart_variables,
  choropleth,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const { t } = useTranslation(["dashboard-blood-donation", "common"]);

  return (
    <AnalyticsProvider meta={meta}>
      <Metadata title={t("header")} description={t("description")} keywords="" />
      <BloodDonationDashboard
        last_updated={last_updated}
        next_update={next_update}
        params={params}
        timeseries={timeseries}
        barchart_age={barchart_age}
        barchart_time={barchart_time}
        barchart_variables={barchart_variables}
        choropleth={choropleth}
      />
    </AnalyticsProvider>
  );
};

BloodDonation.layout = (page, props) => (
  <WindowProvider>
    <Layout
      stateSelector={
        <StateDropdown
          width="w-max xl:w-64"
          url={routes.BLOOD_DONATION}
          currentState={props.params.state}
          exclude={["pjy", "pls", "lbn"]}
          hideOnScroll
        />
      }
    >
      <StateModal
        url={routes.BLOOD_DONATION}
        state={props.params.state}
        exclude={["pjy", "pls", "lbn"]}
      />
      {page}
    </Layout>
  </WindowProvider>
);

export const getStaticProps: GetStaticProps = withi18n(
  ["dashboard-blood-donation", "common"],
  async () => {
    const { data } = await get("/dashboards/blood-donation-mys.json", {}, "api_s3");

    const EMPTY_XY = { x: [], y: [] };

    const withVariableDefaults = (period: any) => ({
      blood_group: period?.blood_group ?? [],
      donation_type: period?.donation_type ?? [],
      location: period?.location ?? [],
      donation_regularity: period?.donation_regularity ?? [],
      social_group: period?.social_group ?? [],
    });

    // transform: guard against missing monthly data
    if (data.bar_chart_time?.data?.monthly?.x) {
      data.bar_chart_time.data.monthly.x = data.bar_chart_time.data.monthly.x.map((item: any) => {
        const period = DateTime.fromFormat(item, "yyyy-MM-dd");
        return period.monthShort !== "Jan" ? period.monthShort : period.year.toString();
      });
    }

    return {
      notFound: false,
      props: {
        meta: {
          id: "dashboard-blood-donation",
          type: "dashboard",
          category: "healthcare",
          agency: "PDN",
        },
        last_updated: data.data_last_updated,
        next_update: data.data_next_update,
        params: { state: "mys" },
        timeseries: data.timeseries_all,
        barchart_age: {
          data_as_of: data.bar_chart_age?.data_as_of ?? "",
          data: {
            past_month: data.bar_chart_age?.data?.past_month ?? EMPTY_XY,
            past_year: data.bar_chart_age?.data?.past_year ?? EMPTY_XY,
          },
        },
        barchart_time: data.bar_chart_time,
        barchart_variables: {
          data_as_of: data.barchart_key_variables?.data_as_of ?? "",
          data: {
            yesterday: withVariableDefaults(data.barchart_key_variables?.data?.yesterday),
            past_month: withVariableDefaults(data.barchart_key_variables?.data?.past_month),
            past_year: withVariableDefaults(data.barchart_key_variables?.data?.past_year),
          },
        },
        choropleth: data.choropleth_malaysia,
      },
      revalidate: ISR_REVALIDATE,
    };
  }
);

export default BloodDonation;
