import { NextRequest, NextResponse } from "next/server";
import { talexioQuery } from "@/lib/talexio/auth";

export const maxDuration = 60;

// Pre-built queries for each action
const QUERIES: Record<
  string,
  {
    query: string;
    variables?: (params: URLSearchParams) => Record<string, unknown>;
  }
> = {
  employees: {
    query: `query {
      employees {
        id firstName lastName fullName employeeCode emailAddress
        isTerminated
        currentPositionSimple {
          id isEnded
          position { id name }
          organisationUnit { id name }
        }
      }
    }`,
  },
  headcount: {
    query: `query {
      employees {
        id fullName isTerminated
        currentPositionSimple {
          id isEnded
          position { id name }
          organisationUnit { id name }
        }
      }
    }`,
  },
  timelogs: {
    query: `query {
      employees {
        id fullName isTerminated
        timeLogs {
          ... on TimeLogEntry {
            id from to label
            locationLongIn locationLatIn
            locationLongOut locationLatOut
            employee { id fullName }
          }
        }
      }
    }`,
  },
  leave: {
    query: `query {
      employees {
        id fullName isTerminated
        leaveEntitlements {
          ... on LeaveEntitlement {
            id entitlement year
            leaveType { id name }
            businessUnit { id name }
          }
        }
      }
    }`,
  },
  shifts: {
    query: `query ($employeeIds: [ID!]!, $dateFrom: Date!, $dateTo: Date!) {
      selectedEmployees: employees(params: { employeeIds: $employeeIds }) {
        id fullName
        workShifts(dateFrom: $dateFrom, dateTo: $dateTo, onlyPublished: true) {
          id label type date from to
          employee { id fullName }
        }
      }
    }`,
    variables: (params) => ({
      employeeIds: (params.get("employeeIds") || "").split(","),
      dateFrom: params.get("dateFrom") || "",
      dateTo: params.get("dateTo") || "",
    }),
  },
  payrolls: {
    query: `query ($year: Int!) {
      payrolls(year: $year) { id payDate periodFrom periodTo isLocked }
    }`,
    variables: (params) => ({
      year: parseInt(params.get("year") || "2026"),
    }),
  },
  payslips: {
    query: `query {
      employees {
        id fullName isTerminated
        currentPositionSimple {
          position { name }
          organisationUnit { name }
        }
        payslips {
          ... on PayrollPayslip {
            id gross net tax periodFrom periodTo
          }
        }
      }
    }`,
  },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (!action || !QUERIES[action]) {
    return NextResponse.json(
      { error: `Invalid action. Available: ${Object.keys(QUERIES).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const config = QUERIES[action];
    const variables = config.variables ? config.variables(searchParams) : undefined;
    const result = await talexioQuery(config.query, variables);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
