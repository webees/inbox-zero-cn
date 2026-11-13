export type BusyPeriod = {
  start: string;
  end: string;
};

export interface CalendarAvailabilityProvider {
  /**
   * 获取给定日历的忙碌时段
   */
  fetchBusyPeriods(params: {
    accessToken?: string | null;
    connectionId?: string | null;
    refreshToken: string | null;
    expiresAt: number | null;
    emailAccountId: string;
    calendarIds: string[];
    timeMin: string;
    timeMax: string;
    failOnCalendarError?: boolean;
  }): Promise<BusyPeriod[]>;
  name: "google" | "microsoft";
}
