import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

// Full hardcoded COA_MAP: account_code → [split_rule_name, ebitda_line]
const COA_DEFAULTS: Record<string, [string, string]> = {
  // COGS
  "651110": ["By sales ratio",        "cogs"],
  "651120": ["By sales ratio",        "cogs"],
  "651210": ["100% InterContinental", "cogs"],
  "651220": ["100% InterContinental", "cogs"],
  "651310": ["100% Ramla",            "cogs"],
  "651320": ["100% Ramla",            "cogs"],
  "651410": ["100% Sunny Coast",      "cogs"],
  "651420": ["100% Sunny Coast",      "cogs"],
  "651510": ["100% Hugos",           "cogs"],
  "651520": ["100% Hugos",           "cogs"],
  "651610": ["100% Hyatt",            "cogs"],
  "651620": ["100% Hyatt",            "cogs"],
  "651630": ["By sales ratio",        "cogs"],
  "651640": ["By sales ratio",        "cogs"],
  "655110": ["By sales ratio",        "cogs"],
  "659110": ["By sales ratio",        "cogs"],
  "659120": ["By sales ratio",        "cogs"],
  "659130": ["By sales ratio",        "cogs"],
  "659140": ["By sales ratio",        "cogs"],
  "659150": ["By sales ratio",        "cogs"],
  "659151": ["Equal across all SPAs", "cogs"],
  "659152": ["Equal across all SPAs", "cogs"],
  "659153": ["Equal across all SPAs", "cogs"],
  "651111": ["Equal across all SPAs", "cogs"],
  "5552":   ["Equal across all SPAs", "cogs"],
  "147806": ["By sales ratio",        "cogs"],
  "651625": ["Equal across all SPAs", "cogs"],
  "659172": ["By sales ratio",        "cogs"],
  "651130": ["Equal across all SPAs", "sga"],
  // WAGES
  "616100": ["By sales ratio",        "wages"],
  "616110": ["By sales ratio",        "wages"],
  "616111": ["By sales ratio",        "wages"],
  "616112": ["By sales ratio",        "wages"],
  "616113": ["By sales ratio",        "wages"],
  "616114": ["100% InterContinental", "wages"],
  "616115": ["100% Hugos",           "wages"],
  "616116": ["100% Hyatt",            "wages"],
  "616117": ["100% Ramla",            "wages"],
  "616118": ["100% Sunny Coast",      "wages"],
  "616120": ["100% InterContinental", "wages"],
  "616121": ["100% Hugos",           "wages"],
  "616122": ["100% Hyatt",            "wages"],
  "616123": ["100% Ramla",            "wages"],
  "616124": ["100% Sunny Coast",      "wages"],
  "616130": ["100% InterContinental", "wages"],
  "616131": ["100% Hugos",           "wages"],
  "616132": ["100% Hyatt",            "wages"],
  "616133": ["100% Ramla",            "wages"],
  "616134": ["100% Sunny Coast",      "wages"],
  "616140": ["100% InterContinental", "wages"],
  "616141": ["100% Hugos",           "wages"],
  "616142": ["100% Hyatt",            "wages"],
  "616143": ["100% Ramla",            "wages"],
  "616144": ["100% Sunny Coast",      "sga"],
  "616145": ["By sales ratio",        "wages"],
  "616150": ["By sales ratio",        "wages"],
  "616660": ["By salary cost",        "wages"],
  "30001":  ["100% InterContinental", "wages"],
  "30002":  ["100% Hugos",           "wages"],
  "30003":  ["100% Hyatt",            "wages"],
  "30004":  ["100% Sunny Coast",      "wages"],
  "30005":  ["100% Ramla",            "wages"],
  "30006":  ["100% Riviera",         "wages"],
  "602220": ["By sales ratio",        "wages"],
  "602221": ["100% Excelsior",        "wages"],
  "602222": ["100% Novotel",          "wages"],
  "1":      ["By sales ratio",        "wages"],
  "11":     ["By sales ratio",        "wages"],
  "123":    ["100% Sunny Coast",      "wages"],
  "145":    ["By sales ratio",        "wages"],
  "659171": ["By sales ratio",        "wages"],
  // ADVERTISING
  "611111": ["By sales ratio",        "advertising"],
  "611112": ["By sales ratio",        "advertising"],
  "611113": ["By sales ratio",        "advertising"],
  "659168": ["Equal across all SPAs", "advertising"],
  // RENT
  "619000": ["Equal across all SPAs", "rent"],
  "619110": ["100% Ramla",            "rent"],
  "619120": ["100% Sunny Coast",      "rent"],
  "619121": ["100% Excelsior",        "rent"],
  "619123": ["100% Novotel",          "rent"],
  "619140": ["100% InterContinental", "rent"],
  "619150": ["100% Hyatt",            "rent"],
  "619160": ["100% Hugos",           "rent"],
  "10001":  ["100% Sunny Coast",      "rent"],
  "0":      ["100% Riviera",         "rent"],
  "619500": ["Equal across all SPAs", "rent"],
  "619510": ["Equal across all SPAs", "rent"],
  "619520": ["Equal across all SPAs", "rent"],
  "619530": ["Equal across all SPAs", "rent"],
  "7786":   ["Equal across all SPAs", "rent"],
  "659162": ["Equal across all SPAs", "rent"],
  // UTILITIES
  "100":     ["Equal across all SPAs", "utilities"],
  "9090":    ["100% Riviera",         "utilities"],
  "611511":  ["100% InterContinental", "utilities"],
  "611521":  ["100% Hyatt",            "utilities"],
  "611531":  ["100% Hugos",           "utilities"],
  "611541":  ["100% Sunny Coast",      "utilities"],
  "611551":  ["100% Ramla",            "utilities"],
  "611561":  ["By sales ratio",        "utilities"],
  "611562":  ["100% Riviera",         "utilities"],
  "611563":  ["100% Novotel",          "utilities"],
  "611564":  ["100% Excelsior",        "utilities"],
  "12346":   ["100% Sunny Coast",      "utilities"],
  "6125000": ["Equal across all SPAs", "utilities"],
  "659163":  ["Equal across all SPAs", "utilities"],
  // SG&A
  "616780":  ["Equal across all SPAs", "sga"],
  "611120":  ["By sales ratio",        "sga"],
  "611130":  ["Equal across all SPAs", "sga"],
  "611141":  ["Equal across all SPAs", "sga"],
  "611142":  ["Equal across all SPAs", "sga"],
  "611143":  ["Equal across all SPAs", "sga"],
  "611151":  ["By salary cost",        "sga"],
  "611152":  ["100% InterContinental", "sga"],
  "611160":  ["Equal across all SPAs", "sga"],
  "611170":  ["By sales ratio",        "sga"],
  "611180":  ["Equal across all SPAs", "sga"],
  "611191":  ["Equal across all SPAs", "sga"],
  "611192":  ["Equal across all SPAs", "sga"],
  "611193":  ["By sales ratio",        "sga"],
  "611194":  ["Equal across all SPAs", "sga"],
  "611195":  ["Equal across all SPAs", "sga"],
  "611200":  ["Equal across all SPAs", "sga"],
  "611220":  ["Equal across all SPAs", "sga"],
  "611221":  ["Equal across all SPAs", "sga"],
  "611222":  ["Equal across all SPAs", "sga"],
  "611223":  ["Equal across all SPAs", "sga"],
  "611224":  ["Equal across all SPAs", "sga"],
  "611225":  ["Equal across all SPAs", "sga"],
  "611230":  ["Equal across all SPAs", "sga"],
  "611240":  ["Equal across all SPAs", "sga"],
  "611251":  ["By sales ratio",        "sga"],
  "611252":  ["By sales ratio",        "sga"],
  "611253":  ["Equal across all SPAs", "sga"],
  "611254":  ["By sales ratio",        "sga"],
  "611512":  ["100% InterContinental", "sga"],
  "611513":  ["100% InterContinental", "sga"],
  "611514":  ["100% InterContinental", "sga"],
  "611515":  ["100% InterContinental", "sga"],
  "611516":  ["100% InterContinental", "sga"],
  "611517":  ["100% InterContinental", "sga"],
  "611518":  ["100% InterContinental", "sga"],
  "611519":  ["Equal across all SPAs", "sga"],
  "611520":  ["Equal across all SPAs", "sga"],
  "611522":  ["100% Hyatt",            "sga"],
  "611523":  ["100% Hyatt",            "sga"],
  "611524":  ["100% Hyatt",            "sga"],
  "611525":  ["100% Hyatt",            "sga"],
  "611526":  ["100% Hyatt",            "sga"],
  "611527":  ["100% Hyatt",            "sga"],
  "611528":  ["100% Hyatt",            "sga"],
  "611530":  ["By sales ratio",        "sga"],
  "611532":  ["100% Hugos",           "sga"],
  "611533":  ["100% Hugos",           "sga"],
  "611534":  ["100% Hugos",           "sga"],
  "611535":  ["100% Hugos",           "sga"],
  "611536":  ["100% Hugos",           "sga"],
  "611537":  ["100% Hugos",           "sga"],
  "611538":  ["100% Hugos",           "sga"],
  "611539":  ["By salary cost",        "sga"],
  "611540":  ["Equal across all SPAs", "sga"],
  "611542":  ["100% Sunny Coast",      "sga"],
  "611543":  ["100% Sunny Coast",      "sga"],
  "611544":  ["100% Sunny Coast",      "sga"],
  "611545":  ["100% Sunny Coast",      "sga"],
  "611546":  ["100% Sunny Coast",      "sga"],
  "611547":  ["100% Sunny Coast",      "sga"],
  "611548":  ["100% Sunny Coast",      "sga"],
  "611550":  ["100% Excelsior",        "sga"],
  "611570":  ["100% Excelsior",        "sga"],
  "611552":  ["100% Ramla",            "sga"],
  "611553":  ["100% Ramla",            "sga"],
  "611554":  ["100% Ramla",            "sga"],
  "611555":  ["100% Ramla",            "sga"],
  "611556":  ["100% Ramla",            "sga"],
  "611557":  ["100% Ramla",            "sga"],
  "611558":  ["100% Ramla",            "sga"],
  "611559":  ["Equal across all SPAs", "sga"],
  "611560":  ["100% Novotel",          "sga"],
  "611572":  ["100% Novotel",          "sga"],
  "611571":  ["Equal across all SPAs", "sga"],
  "611110":  ["", "excluded"],   // Depreciation
  "611114":  ["", "excluded"],   // Depreciation
  "611115":  ["", "excluded"],   // Depreciation
  "611196":  ["Equal across all SPAs", "sga"],
  "612520":  ["Equal across all SPAs", "sga"],
  "651180":  ["Equal across all SPAs", "sga"],
  "400025":  ["Equal across all SPAs", "sga"],
  "600":     ["Equal across all SPAs", "sga"],
  "12":      ["Equal across all SPAs", "sga"],
  "2222":    ["By salary cost",        "sga"],
  "98765":   ["Equal across all SPAs", "sga"],
  "4411":    ["100% Riviera",         "sga"],
  "619122":  ["100% Riviera",         "sga"],
  "619126":  ["100% Riviera",         "sga"],
  "1457":    ["100% Sunny Coast",      "sga"],
  "1566":    ["100% Riviera",         "sga"],
  "14575":   ["100% Novotel",          "sga"],
  "60007":   ["100% Riviera",         "sga"],
  "123456":  ["Equal across all SPAs", "sga"],
  "123455":  ["Equal across all SPAs", "sga"],
  "CUST":    ["Equal across all SPAs", "sga"],
  "659157":  ["Equal across all SPAs", "sga"],
  "659158":  ["Equal across all SPAs", "sga"],
  "659159":  ["Equal across all SPAs", "sga"],
  "659160":  ["Equal across all SPAs", "sga"],
  "659161":  ["Equal across all SPAs", "sga"],
  "659164":  ["Equal across all SPAs", "sga"],
  "659165":  ["Equal across all SPAs", "sga"],
  "659166":  ["Equal across all SPAs", "sga"],
  "659167":  ["Equal across all SPAs", "sga"],
  "659169":  ["Equal across all SPAs", "sga"],
  "659170":  ["Equal across all SPAs", "sga"],
  "659173":  ["By salary cost",        "sga"],
  "659174":  ["By sales ratio",        "sga"],
  "659175":  ["Equal across all SPAs", "sga"],
  "659176":  ["Equal across all SPAs", "sga"],
  "659177":  ["Equal across all SPAs", "sga"],
  "616610":  ["By sales ratio",        "sga"],
  "616611":  ["By sales ratio",        "sga"],
  "616620":  ["By sales ratio",        "sga"],
  "616630":  ["By sales ratio",        "sga"],
  "616640":  ["By salary cost",        "sga"],
  "616641":  ["100% InterContinental", "sga"],
  "616642":  ["100% Sunny Coast",      "sga"],
  "616643":  ["100% Ramla",            "sga"],
  "616644":  ["By salary cost",        "sga"],
  "616650":  ["Equal across all SPAs", "sga"],
  "616670":  ["By sales ratio",        "sga"],
  "616671":  ["100% Ramla",            "sga"],
  "616680":  ["Equal across all SPAs", "sga"],
  "616681":  ["Equal across all SPAs", "sga"],
  "616700":  ["Equal across all SPAs", "sga"],
  "616710":  ["By sales ratio",        "sga"],
  "616720":  ["Equal across all SPAs", "sga"],
  "616730":  ["Equal across all SPAs", "sga"],
  "616740":  ["Equal across all SPAs", "sga"],
  "616750":  ["Equal across all SPAs", "sga"],
  "616770":  ["Equal across all SPAs", "sga"],
  "616771":  ["100% Riviera",         "sga"],
  "605":     ["Equal across all SPAs", "sga"],
  "6050005": ["Equal across all SPAs", "sga"],
  "2356":    ["", "excluded"],   // Assets Written Off / Amortisation
  "616800":  ["Equal across all SPAs", "sga"],
  "25":      ["Equal across all SPAs", "sga"],
  "999":     ["Equal across all SPAs", "sga"],
};

// Display names for all accounts — used when inserting rows not returned by Zoho's API
const COA_NAMES: Record<string, string> = {
  // COGS
  "651110": "General Purchases - Professional Products",
  "651120": "General Purchases - Retail Products",
  "651210": "Purchases - InterContinental (Professional)",
  "651220": "Purchases - InterContinental (Retail)",
  "651310": "Purchases - Ramla (Professional)",
  "651320": "Purchases - Ramla (Retail)",
  "651410": "Purchases - Sunny Coast (Professional)",
  "651420": "Purchases - Sunny Coast (Retail)",
  "651510": "Purchases - Hugo's (Professional)",
  "651520": "Purchases - Hugo's (Retail)",
  "651610": "Hyatt Purchases - Professional Products",
  "651620": "Hyatt Purchases - Retail Products",
  "651630": "Nails - Retail",
  "651640": "Others - Retail",
  "655110": "Paypal - C.C. Processing",
  "659110": "Product - Commission",
  "659120": "Service - Commission",
  "659130": "Re-Book - Commission",
  "659140": "Sale - Commission",
  "659150": "Spa Club/Sessions - Commission",
  "659151": "Freight, Insurance and Duty",
  "659152": "Stock Written Off",
  "659153": "Closing Stock",
  "651111": "Opening Stock",
  "5552":   "Local Purchases of Raw Materials",
  "147806": "Linen Cost",
  "651625": "Purchase-Stock",
  "659172": "Cost of Goods Sold - The Purest Solutions",
  "651130": "Tester Products",
  // WAGES
  "616100": "Salaries & Wages",
  "616110": "Salaries & Wages - Directors",
  "616111": "Salaries & Wages - Corporative Manager",
  "616112": "Salaries & Wages - Other",
  "616113": "Salary & Payroll Taxes (FS5) Corporative",
  "616114": "Salary & Payroll Taxes (FS5) InterContinental",
  "616115": "Salary & Payroll Taxes (FS5) Hugo's",
  "616116": "Salary & Payroll Taxes (FS5) Hyatt",
  "616117": "Salary & Payroll Taxes (FS5) Ramla",
  "616118": "Salary & Payroll Taxes (FS5) Sunny Coast",
  "616120": "Salaries & Wages - InterContinental",
  "616121": "Salaries & Wages - Hugo's",
  "616122": "Salaries & Wages - Hyatt",
  "616123": "Salaries & Wages - Ramla",
  "616124": "Salaries & Wages - Sunny Coast",
  "616130": "Wages - InterContinental",
  "616131": "Wages - Hugo's",
  "616132": "Wages - Hyatt",
  "616133": "Wages - Ramla",
  "616134": "Wages - Sunny Coast",
  "616140": "Overtime - InterContinental",
  "616141": "Overtime - Hugo's",
  "616142": "Overtime - Hyatt",
  "616143": "Overtime - Ramla",
  "616144": "Overtime - Sunny Coast (Therapist)",
  "616145": "Salaries & Wages - Hairdresser",
  "616150": "Salaries & Wages - Support",
  "616660": "N.I. & PAYE - General",
  "30001":  "Salaries & Wages - InterContinental",
  "30002":  "Salaries & Wages - Hugo's",
  "30003":  "Salaries & Wages - Hyatt",
  "30004":  "Salaries & Wages - Sunny Coast",
  "30005":  "Salaries & Wages - Ramla",
  "30006":  "Salaries & Wages - Riviera",
  "602220": "Salary & Wages - Centre",
  "602221": "Salaries & Wages - Excelsior",
  "602222": "Salaries & Wages - Novotel",
  "1":      "Salaries & Wages - Masseuse",
  "11":     "Salaries & Wages - Receptionist",
  "123":    "Salaries & Wages - Manager (Sunny Coast)",
  "145":    "Salaries & Wages - Graphic Designer",
  "659171": "Salaries & Wages - The Purest Solutions",
  // ADVERTISING
  "611111": "Advertising",
  "611112": "Marketing",
  "611113": "Digital Marketing",
  "659168": "Advertising - The Purest Solutions",
  // RENT
  "619000": "Rent",
  "619110": "Rent - Ramla",
  "619120": "Rent - Sunny Coast",
  "619121": "Rent - Excelsior",
  "619123": "Rent - Novotel",
  "619140": "Rent - InterContinental",
  "619150": "Rent - Hyatt",
  "619160": "Rent - Hugo's",
  "10001":  "Rent - Sunny Coast",
  "0":      "Rent - Riviera",
  "619500": "Rent - Motor Vehicle",
  "619510": "Rent - Equipment",
  "619520": "Rent - Storage",
  "619530": "Rent - Flat",
  "7786":   "Mobile & Telephone Rent",
  "659162": "Rent - The Purest Solutions",
  // UTILITIES
  "100":     "Water & Electricity",
  "9090":    "Water & Electricity - Riviera",
  "611511":  "Water & Electricity - InterContinental",
  "611521":  "Water & Electricity - Hyatt",
  "611531":  "Water & Electricity - Hugo's",
  "611541":  "Water & Electricity - Sunny Coast",
  "611551":  "Water & Electricity - Ramla",
  "611561":  "Water & Electricity - Office",
  "611562":  "Water & Electricity - Riviera",
  "611563":  "Water & Electricity - Novotel",
  "611564":  "Water & Electricity - Excelsior",
  "12346":   "Utilities - Sunny Coast",
  "6125000": "Utilities",
  "659163":  "Utilities - The Purest Solutions",
  // SG&A
  "616780":  "Bank Fees and Charges",
  "611120":  "Consumables",
  "611130":  "Research & Development",
  "611141":  "Buildings - Repairs & Maintenance",
  "611142":  "Motor Vehicles - Repairs & Maintenance",
  "611143":  "Machines & Equipment - Repairs & Maintenance",
  "611151":  "Car - Fuel",
  "611152":  "Hammam - Fuel - InterContinental",
  "611160":  "SG&A",
  "611170":  "Discounts",
  "611180":  "SG&A",
  "611191":  "SG&A",
  "611192":  "SG&A",
  "611193":  "SG&A",
  "611194":  "SG&A",
  "611195":  "SG&A",
  "611200":  "SG&A",
  "611220":  "SG&A",
  "611221":  "SG&A",
  "611222":  "SG&A",
  "611223":  "SG&A",
  "611224":  "SG&A",
  "611225":  "SG&A",
  "611230":  "SG&A",
  "611240":  "SG&A",
  "611251":  "SG&A",
  "611252":  "SG&A",
  "611253":  "SG&A",
  "611254":  "SG&A",
  "611512":  "Telephony & Wifi - InterContinental",
  "611513":  "Cleaning - InterContinental",
  "611514":  "Laundry - InterContinental",
  "611515":  "Consumables - InterContinental",
  "611516":  "Meals & Entertainment - InterContinental",
  "611517":  "Spa Insurance - InterContinental",
  "611518":  "Repairs & Maintenance - InterContinental",
  "611519":  "Repairs & Maintenance - Buildings",
  "611520":  "Laundry",
  "611522":  "SG&A - Hyatt",
  "611523":  "SG&A - Hyatt",
  "611524":  "SG&A - Hyatt",
  "611525":  "SG&A - Hyatt",
  "611526":  "SG&A - Hyatt",
  "611527":  "SG&A - Hyatt",
  "611528":  "SG&A - Hyatt",
  "611530":  "Telephone & Communications",
  "611532":  "SG&A - Hugo's",
  "611533":  "SG&A - Hugo's",
  "611534":  "SG&A - Hugo's",
  "611535":  "SG&A - Hugo's",
  "611536":  "SG&A - Hugo's",
  "611537":  "SG&A - Hugo's",
  "611538":  "SG&A - Hugo's",
  "611539":  "Meals & Entertainment",
  "611540":  "Mobile, Telephone & Communications",
  "611542":  "SG&A - Sunny Coast",
  "611543":  "SG&A - Sunny Coast",
  "611544":  "SG&A - Sunny Coast",
  "611545":  "SG&A - Sunny Coast",
  "611546":  "SG&A - Sunny Coast",
  "611547":  "SG&A - Sunny Coast",
  "611548":  "SG&A - Sunny Coast",
  "611550":  "Meals & Entertainment - Excelsior",
  "611570":  "Laundry - Excelsior",
  "611552":  "SG&A - Ramla",
  "611553":  "SG&A - Ramla",
  "611554":  "SG&A - Ramla",
  "611555":  "SG&A - Ramla",
  "611556":  "SG&A - Ramla",
  "611557":  "SG&A - Ramla",
  "611558":  "SG&A - Ramla",
  "611559":  "Repairs & Maintenance - General",
  "611560":  "SG&A - Novotel",
  "611572":  "Laundry - Novotel",
  "611571":  "SG&A (General)",
  "611110":  "Depreciation",
  "611114":  "Depreciation",
  "611115":  "Depreciation",
  "611196":  "SG&A",
  "612520":  "SG&A",
  "651180":  "SG&A",
  "400025":  "SG&A",
  "600":     "SG&A",
  "12":      "SG&A",
  "2222":    "SG&A",
  "98765":   "SG&A",
  "4411":    "SG&A - Riviera",
  "619122":  "SG&A - Riviera",
  "619126":  "SG&A - Riviera",
  "1457":    "SG&A - Sunny Coast",
  "1566":    "SG&A - Riviera",
  "14575":   "SG&A - Novotel",
  "60007":   "SG&A - Riviera",
  "123456":  "SG&A",
  "123455":  "SG&A",
  "CUST":    "Custom SG&A",
  "659157":  "SG&A - The Purest Solutions",
  "659158":  "SG&A - The Purest Solutions",
  "659159":  "SG&A - The Purest Solutions",
  "659160":  "SG&A - The Purest Solutions",
  "659161":  "SG&A - The Purest Solutions",
  "659164":  "SG&A - The Purest Solutions",
  "659165":  "SG&A - The Purest Solutions",
  "659166":  "SG&A - The Purest Solutions",
  "659167":  "SG&A - The Purest Solutions",
  "659169":  "SG&A - The Purest Solutions",
  "659170":  "SG&A - The Purest Solutions",
  "659173":  "SG&A - The Purest Solutions",
  "659174":  "SG&A - The Purest Solutions",
  "659175":  "SG&A - The Purest Solutions",
  "659176":  "SG&A - The Purest Solutions",
  "659177":  "SG&A - The Purest Solutions",
  "616610":  "Travel & Subsistence",
  "616611":  "Travel & Subsistence",
  "616620":  "Staff Entertainment",
  "616630":  "Staff Training",
  "616640":  "Staff Welfare",
  "616641":  "Staff Welfare - InterContinental",
  "616642":  "Staff Welfare - Sunny Coast",
  "616643":  "Staff Welfare - Ramla",
  "616644":  "Staff Welfare",
  "616650":  "Recruitment",
  "616670":  "Uniforms",
  "616671":  "Uniforms - Ramla",
  "616680":  "IT & Software",
  "616681":  "IT & Software",
  "616700":  "Legal & Professional",
  "616710":  "Accounting & Audit",
  "616720":  "Insurance",
  "616730":  "Bank Charges",
  "616740":  "Postage & Stationery",
  "616750":  "Sundry Expenses",
  "616770":  "Miscellaneous",
  "616771":  "Miscellaneous - Riviera",
  "605":     "Interest Paid",
  "6050005": "Subcontractor",
  "2356":    "Assets Written Off / Amortisation",
  "616800":  "Corporate Tax",
  "25":      "Unprocessed Transactions",
  "999":     "Repairs & Maintenance",
};

function accountTypeForLine(ebitdaLine: string): string {
  if (ebitdaLine === "cogs") return "Cost of Goods Sold";
  return "Expense";
}

// ── SG&A sub-category fuzzy classifier ───────────────────────────────────────
// Returns a granular sga_* ebitda_line based on account name keywords.
// Order matters: more specific patterns first.
const SGA_KEYWORD_MAP: [string[], string][] = [
  [["laundry", "linen", "dry clean", "uniform clean", "washing"],                              "sga_laundry"],
  [["fuel", "petrol", "diesel", "motor expense", "vehicle fuel"],                              "sga_fuel"],
  [["software", "subscription", "saas", "licence", "license", "hosting", "cloud",
    "microsoft", "google workspace", "adobe", "platform", "it service"],                      "sga_software"],
  [["cleaning", "sanitation", "hygiene", "pest control", "janitorial", "disinfect"],          "sga_cleaning"],
  [["travel", "transport", "taxi", "uber", "flight", "accommodation",
    "parking", "car hire", "car rental", "vehicle hire", "transfer expense",
    "hotel", "airbnb", "airline", "airways"],                                                 "sga_travel"],
  [["insurance", "policy premium", "indemnity"],                                              "sga_insurance"],
  [["event", "conference", "seminar", "entertainment", "hospitality",
    "team building", "staff function", "function expense"],                                   "sga_events"],
  [["maintenance", "repair", "upkeep", "equipment service", "machine service", "fix"],        "sga_maintenance"],
  [["telecom", "telephone", "mobile", "internet", "broadband", "wifi",
    "communication", "phone", "data plan"],                                                   "sga_telecom"],
  [["professional", "consultant", "consult", "legal", "accounting", "audit",
    "advisory", "outsourc", "subcontract", "solicitor", "lawyer",
    "architect", "surveyor", "notary", "prof service"],                                       "sga_prof_services"],
  [["misc", "miscellaneous", "sundry", "other expense", "general expense",
    "petty cash", "unprocessed"],                                                             "sga_misc"],
];

function classifySgaSubcategory(name: string): string {
  const low = name.toLowerCase();
  for (const [keywords, line] of SGA_KEYWORD_MAP) {
    if (keywords.some(kw => low.includes(kw))) return line;
  }
  return "sga_misc";
}

// ── Aesthetics & Slimming auto-classification ─────────────────────────────────
// Applied when org === "aesthetics". Classifies already-synced accounts by name
// keyword. Split rule assignment:
//   revenue  → "By sales ratio"
//   wages    → "By salary ratio"
//   all other EBITDA lines → "Equal (Aesthetics & Slimming)"
//   excluded → no split rule
// Label-detected accounts (name contains "aesthetics" or "slimming") are
// handled by the ETL label-check step, not by the split rule.

const AESTH_KEYWORD_MAP: [string[], string][] = [
  [["sales", "revenue", "income", "membership", "treatment income", "service income",
    "service revenue", "product sales", "consultation fee"], "revenue"],
  [["cost of goods", "cogs", "consumable", "product cost", "treatment supply",
    "treatment material", "stock"], "cogs"],
  [["salary", "salaries", "wage", "overtime", "bonus", "commission",
    "national insurance", "social security", "employer ni", "payroll",
    "sick pay", "maternity"], "wages"],
  [["advertis", "marketing", "influencer", "photograp", "video content",
    "promotion", "social media", "meta ads", "google ads", "digital"], "advertising"],
  [["rent", "lease", "service charge", "property tax", "occupancy"], "rent"],
  [["electric", "water", "internet", "broadband", "telephone", "mobile",
    "gas", "utility", "wifi"], "utilities"],
  [["depreciat", "amortis", "interest paid", "finance charge",
    "corporation tax", "income tax", "bank interest"], "excluded"],
];

function classifyAestheticsAccount(name: string, accountType: string): string {
  const low = name.toLowerCase();
  for (const [keywords, line] of AESTH_KEYWORD_MAP) {
    if (keywords.some(kw => low.includes(kw))) return line;
  }
  const t = accountType.toLowerCase().replace(/\s+/g, "_");
  if (t === "income" || t === "other_income") return "revenue";
  if (t === "cost_of_goods_sold") return "cogs";
  return classifySgaSubcategory(name);
}

async function seedAesthetics(
  supabase: SupabaseClient,
  org: string,
  ruleByName: Record<string, number>,
): Promise<{ updated: number }> {
  const { data: rows, error } = await supabase
    .from("zoho_coa_mapping")
    .select("id, account_name, account_type, ebitda_line")
    .eq("zoho_org", org);
  if (error) throw new Error(error.message);

  // Only auto-classify rows that have no EBITDA line yet
  const toUpdate = (rows ?? []).filter(r => !r.ebitda_line);
  let updated = 0;
  const CHUNK = 50;

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const batch = toUpdate.slice(i, i + CHUNK);
    await Promise.all(batch.map(r => {
      const line = classifyAestheticsAccount(r.account_name ?? "", r.account_type ?? "");
      // Assign the most appropriate system split rule for each EBITDA line
      let splitRuleId: number | null = null;
      if (line !== "excluded") {
        if (line === "revenue") {
          splitRuleId = ruleByName["By sales ratio"] ?? ruleByName["Equal (Aesthetics & Slimming)"] ?? null;
        } else if (line === "wages") {
          splitRuleId = ruleByName["By salary ratio"] ?? ruleByName["Equal (Aesthetics & Slimming)"] ?? null;
        } else {
          splitRuleId = ruleByName["Equal (Aesthetics & Slimming)"] ?? null;
        }
      }
      return supabase
        .from("zoho_coa_mapping")
        .update({
          ebitda_line:   line,
          split_rule_id: splitRuleId,
        })
        .eq("id", r.id);
    }));
    updated += batch.length;
  }
  return { updated };
}

export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const { org = "spa" } = await req.json().catch(() => ({}));

  // Load split rules for this org to resolve names → IDs
  const { data: rules, error: rErr } = await supabase
    .from("coa_split_rules").select("id, name").eq("zoho_org", org);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const ruleByName: Record<string, number> = {};
  for (const r of rules ?? []) ruleByName[r.name] = r.id;

  // ── Aesthetics & Slimming: auto-classify by name, no SPA defaults applied ──
  if (org !== "spa") {
    try {
      const { updated } = await seedAesthetics(supabase, org, ruleByName);
      return NextResponse.json({ ok: true, updated, inserted: 0, total: updated,
        note: "Auto-classified unmapped accounts by name keywords. Sync from Zoho first if count is 0." });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── SPA: apply hardcoded COA_DEFAULTS ─────────────────────────────────────
  const { data: existing, error: eErr } = await supabase
    .from("zoho_coa_mapping")
    .select("account_code")
    .eq("zoho_org", org);
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });

  const existingCodes = new Set((existing ?? []).map((r: { account_code: string }) => r.account_code));

  const toUpdate = Object.entries(COA_DEFAULTS).filter(([code]) =>  existingCodes.has(code));
  const toInsert = Object.entries(COA_DEFAULTS).filter(([code]) => !existingCodes.has(code));

  const CHUNK = 50;
  let updated = 0;
  let inserted = 0;

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const batch = toUpdate.slice(i, i + CHUNK);
    await Promise.all(batch.map(([code, [ruleName, ebitdaLine]]) =>
      supabase
        .from("zoho_coa_mapping")
        .update({ ebitda_line: ebitdaLine, split_rule_id: ruleByName[ruleName] ?? null })
        .eq("account_code", code)
        .eq("zoho_org", org)
    ));
    updated += batch.length;
  }

  const insertRows = toInsert.map(([code, [ruleName, ebitdaLine]]) => ({
    account_code:   code,
    account_name:   COA_NAMES[code] ?? code,
    account_type:   accountTypeForLine(ebitdaLine),
    zoho_org:       org,
    ebitda_line:    ebitdaLine,
    split_rule_id:  ruleByName[ruleName] ?? null,
  }));

  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const { error } = await supabase
      .from("zoho_coa_mapping")
      .upsert(insertRows.slice(i, i + CHUNK), { onConflict: "account_code,zoho_org", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    inserted += insertRows.slice(i, i + CHUNK).length;
  }

  // ── Post-pass 1: exclude depreciation / amortisation accounts ───────────────
  const EXCL_KEYWORDS = ["depreciat", "amortis"];
  const { data: allSpaRows } = await supabase
    .from("zoho_coa_mapping")
    .select("id, account_name, ebitda_line")
    .eq("zoho_org", org);

  const toExclude = (allSpaRows ?? []).filter(r => {
    const name = (r.account_name ?? "").toLowerCase();
    return EXCL_KEYWORDS.some(kw => name.includes(kw)) && r.ebitda_line !== "excluded";
  });

  if (toExclude.length > 0) {
    await Promise.all(
      toExclude.map(r =>
        supabase
          .from("zoho_coa_mapping")
          .update({ ebitda_line: "excluded", split_rule_id: null })
          .eq("id", r.id)
      )
    );
    updated += toExclude.length;
  }

  // ── Post-pass 2: refine generic "sga" accounts → granular sga_* sub-category
  const toRefine = (allSpaRows ?? []).filter(r => r.ebitda_line === "sga");
  if (toRefine.length > 0) {
    await Promise.all(
      toRefine.map(r =>
        supabase
          .from("zoho_coa_mapping")
          .update({ ebitda_line: classifySgaSubcategory(r.account_name ?? "") })
          .eq("id", r.id)
      )
    );
    updated += toRefine.length;
  }

  return NextResponse.json({ ok: true, updated, inserted, total: updated + inserted });
}
