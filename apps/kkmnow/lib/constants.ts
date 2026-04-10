/** ISR revalidation interval (seconds). Safety net for multi-instance deployments
 * where on-demand revalidation from the ETL pipeline may only reach one instance. */
export const ISR_REVALIDATE = 60 * 60; // 1 hour
