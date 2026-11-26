/**
 * Fictional EstateAI inventory across Pune. All names, developers and
 * RERA numbers are invented for the demo.
 */
import type { PropertyType } from "@/lib/generated/prisma/enums";

export const LOCATIONS = ["Baner", "Hinjewadi", "Wakad", "Kharadi", "Balewadi"] as const;
export type Location = (typeof LOCATIONS)[number];

export interface PropertySeed {
  slug: string;
  name: string;
  location: Location;
  address: string;
  priceInr: number;
  bedrooms: number;
  propertyType: PropertyType;
  areaSqft: number;
  amenities: string[];
  availability: string;
  unitsAvailable: number;
  developer: string;
  description: string;
}

const L = 100_000; // 1 lakh

export const PROPERTIES: PropertySeed[] = [
  {
    slug: "skyline-residences-baner",
    name: "Skyline Residences",
    location: "Baner",
    address: "Baner–Pashan Link Road, Baner, Pune 411045",
    priceInr: 94 * L,
    bedrooms: 3,
    propertyType: "APARTMENT",
    areaSqft: 1450,
    amenities: ["Rooftop pool", "Gym", "Clubhouse", "Covered parking (2)", "24x7 security", "EV charging"],
    availability: "Ready to move",
    unitsAvailable: 6,
    developer: "Sahyadri Habitats",
    description:
      "East-facing 3BHK homes on high floors with views of the Baner hills. Ready-to-move with occupancy certificate received. Large balconies off the living room and master bedroom, modular kitchen and vitrified flooring. Ten minutes to Balewadi High Street and fifteen minutes to the Hinjewadi IT park via the Mumbai–Bangalore highway. Popular with IT professionals and young families; a reputed CBSE school is 1.2 km away.",
  },
  {
    slug: "baner-greens",
    name: "Baner Greens",
    location: "Baner",
    address: "Mahalunge Road, Baner, Pune 411045",
    priceInr: 88 * L,
    bedrooms: 3,
    propertyType: "APARTMENT",
    areaSqft: 1320,
    amenities: ["Landscaped garden", "Jogging track", "Children's play area", "Gym", "Rainwater harvesting", "Solar water heating"],
    availability: "Under construction — possession June 2027",
    unitsAvailable: 12,
    developer: "GreenLeaf Builders",
    description:
      "A low-density, eco-friendly project with 70% open space and a two-acre central garden. Compact, efficient 3BHK layouts with a dedicated study nook. Construction-linked payment plan with only 10% due on booking. Ideal for buyers who prefer greenery and a quiet neighbourhood while staying close to Baner's restaurants and offices.",
  },
  {
    slug: "the-crest-baner-hills",
    name: "The Crest at Baner Hills",
    location: "Baner",
    address: "Baner Hill Road, Baner, Pune 411045",
    priceInr: 245 * L,
    bedrooms: 4,
    propertyType: "PENTHOUSE",
    areaSqft: 2600,
    amenities: ["Private terrace", "Private plunge pool", "Concierge", "Home automation", "Infinity pool", "Spa", "3 parking slots"],
    availability: "Ready to move",
    unitsAvailable: 2,
    developer: "Sahyadri Habitats",
    description:
      "Duplex luxury penthouses with private terraces and plunge pools overlooking the Baner hill. Italian marble flooring, smart-home automation and a dedicated concierge. Only two units remaining. Suited to senior executives and business owners looking for privacy and premium finishes.",
  },
  {
    slug: "baner-courtyard",
    name: "Baner Courtyard",
    location: "Baner",
    address: "Sus Road, Baner, Pune 411045",
    priceInr: 68 * L,
    bedrooms: 2,
    propertyType: "APARTMENT",
    areaSqft: 980,
    amenities: ["Gym", "Multipurpose hall", "Covered parking (1)", "Power backup"],
    availability: "Sold out",
    unitsAvailable: 0,
    developer: "GreenLeaf Builders",
    description:
      "Value-priced 2BHK homes in a gated community on Sus Road. All units in the current phase are sold; a new phase is expected to launch in 2027.",
  },
  {
    slug: "tech-park-towers-hinjewadi",
    name: "Tech Park Towers",
    location: "Hinjewadi",
    address: "Phase 1, Rajiv Gandhi Infotech Park, Hinjewadi, Pune 411057",
    priceInr: 72 * L,
    bedrooms: 2,
    propertyType: "APARTMENT",
    areaSqft: 1050,
    amenities: ["Co-working lounge", "Gym", "Swimming pool", "Cafeteria", "High-speed fibre", "Shuttle to IT park"],
    availability: "Ready to move",
    unitsAvailable: 20,
    developer: "Infinity Realty",
    description:
      "Walk-to-work 2BHK apartments inside Hinjewadi Phase 1, steps from the largest IT park in Pune. A co-working lounge and a free shuttle to Phases 2 and 3 make it popular with tech professionals and investors; expected rental yield is around 3.5% per year. Metro Line 3 station is under construction 600 m away.",
  },
  {
    slug: "hinjewadi-meadows",
    name: "Hinjewadi Meadows",
    location: "Hinjewadi",
    address: "Marunji Road, Hinjewadi Phase 2, Pune 411057",
    priceInr: 135 * L,
    bedrooms: 3,
    propertyType: "ROW_HOUSE",
    areaSqft: 1900,
    amenities: ["Private garden", "Clubhouse", "Swimming pool", "Pet park", "Covered parking (2)"],
    availability: "Under construction — possession December 2026",
    unitsAvailable: 8,
    developer: "Infinity Realty",
    description:
      "Three-storey row houses with private front gardens, ideal for families who want independent-home living near the IT park. Pet-friendly community with a dedicated pet park. Possession is scheduled for December 2026.",
  },
  {
    slug: "wakad-central",
    name: "Wakad Central",
    location: "Wakad",
    address: "Datta Mandir Road, Wakad, Pune 411057",
    priceInr: 78 * L,
    bedrooms: 2,
    propertyType: "APARTMENT",
    areaSqft: 1000,
    amenities: ["Swimming pool", "Gym", "Indoor games", "Retail plaza", "24x7 security"],
    availability: "Under construction — possession March 2027",
    unitsAvailable: 15,
    developer: "Urbanform Developers",
    description:
      "Spacious 2BHK apartments in the heart of Wakad with a retail plaza on the ground floor. Excellent connectivity to Hinjewadi (10 minutes) and the Mumbai–Pune Expressway. Good choice for first-time buyers.",
  },
  {
    slug: "riverside-wakad",
    name: "Riverside Wakad",
    location: "Wakad",
    address: "Kaspate Wasti, Wakad, Pune 411057",
    priceInr: 105 * L,
    bedrooms: 3,
    propertyType: "APARTMENT",
    areaSqft: 1400,
    amenities: ["Riverfront promenade", "Clubhouse", "Swimming pool", "Gym", "Yoga deck", "Covered parking (2)"],
    availability: "Ready to move",
    unitsAvailable: 4,
    developer: "Urbanform Developers",
    description:
      "Ready-to-move 3BHK homes along the Mula river with a private riverfront promenade and yoga deck. Large windows and cross-ventilation in every room. Close to Phoenix-style malls, hospitals and international schools in Wakad.",
  },
  {
    slug: "kharadi-bay",
    name: "Kharadi Bay",
    location: "Kharadi",
    address: "Kharadi Bypass Road, Kharadi, Pune 411014",
    priceInr: 125 * L,
    bedrooms: 3,
    propertyType: "APARTMENT",
    areaSqft: 1500,
    amenities: ["Sky lounge", "Infinity pool", "Gym", "Business centre", "Covered parking (2)", "EV charging"],
    availability: "Ready to move",
    unitsAvailable: 5,
    developer: "Eastline Estates",
    description:
      "Premium 3BHK residences next to the Kharadi IT and financial district. A 30th-floor sky lounge offers city views. Five minutes from World Trade Center–style office towers, ten minutes from the airport road. Strong rental demand from corporate tenants.",
  },
  {
    slug: "kharadi-urban-nest",
    name: "Kharadi Urban Nest",
    location: "Kharadi",
    address: "Chandan Nagar, Kharadi, Pune 411014",
    priceInr: 48 * L,
    bedrooms: 1,
    propertyType: "APARTMENT",
    areaSqft: 650,
    amenities: ["Gym", "Rooftop garden", "Co-working space", "Laundry room"],
    availability: "Under construction — possession September 2027",
    unitsAvailable: 30,
    developer: "Eastline Estates",
    description:
      "Smart 1BHK homes designed for young professionals and investors. Furnished options available. A rooftop garden and co-working space on site. One of the most affordable entry points into Kharadi.",
  },
  {
    slug: "kharadi-signature-villas",
    name: "Kharadi Signature Villas",
    location: "Kharadi",
    address: "Mundhwa–Kharadi Road, Kharadi, Pune 411014",
    priceInr: 310 * L,
    bedrooms: 4,
    propertyType: "VILLA",
    areaSqft: 3200,
    amenities: ["Private pool", "Private lawn", "Home theatre", "Servant quarters", "Clubhouse", "3 parking slots"],
    availability: "Ready to move",
    unitsAvailable: 3,
    developer: "Eastline Estates",
    description:
      "Independent 4BHK villas with private pools, lawns and a home theatre room in a gated enclave of only 24 villas. Close to the Mundhwa riverside and Koregaon Park. Built for families who want space, privacy and luxury.",
  },
  {
    slug: "balewadi-highstreet-residences",
    name: "Balewadi Highstreet Residences",
    location: "Balewadi",
    address: "Balewadi High Street, Balewadi, Pune 411045",
    priceInr: 92 * L,
    bedrooms: 2,
    propertyType: "APARTMENT",
    areaSqft: 1120,
    amenities: ["Swimming pool", "Gym", "Clubhouse", "Covered parking (1)", "Concierge desk"],
    availability: "Ready to move",
    unitsAvailable: 7,
    developer: "Sahyadri Habitats",
    description:
      "Large 2BHK apartments on Balewadi High Street, Pune's most popular dining and nightlife strip. Walk to cafés, restaurants and the Balewadi stadium. Ideal for professionals who value lifestyle and convenience.",
  },
  {
    slug: "balewadi-sports-city-homes",
    name: "Balewadi Sports City Homes",
    location: "Balewadi",
    address: "Near Shree Shiv Chhatrapati Sports Complex, Balewadi, Pune 411045",
    priceInr: 115 * L,
    bedrooms: 3,
    propertyType: "APARTMENT",
    areaSqft: 1550,
    amenities: ["Olympic-size pool", "Badminton courts", "Cricket net", "Gym", "Jogging track", "Covered parking (2)"],
    availability: "Under construction — possession August 2027",
    unitsAvailable: 10,
    developer: "GreenLeaf Builders",
    description:
      "Sports-themed 3BHK community beside the Balewadi sports complex, with an Olympic-size pool, badminton courts and cricket nets. Great for active families with children. 10% booking amount with a construction-linked plan.",
  },
];

/** Company knowledge base: ingested, chunked and embedded alongside listings. */
export const COMPANY_DOCS: { title: string; sourceType: "COMPANY_FAQ" | "POLICY"; content: string }[] = [
  {
    title: "About EstateAI",
    sourceType: "COMPANY_FAQ",
    content: `EstateAI is a Pune-based real estate sales and advisory company founded in 2016. We represent residential projects from partner developers across West and East Pune, focusing on Baner, Balewadi, Hinjewadi, Wakad and Kharadi.

Our office is at Level 4, Pinnacle Business Park, Baner, Pune 411045. Office hours are Monday to Saturday, 10:00 AM to 7:00 PM IST. We are closed on Sundays.

EstateAI does not charge buyers any brokerage on primary (new) sales — our fee is paid by the developer. Every project we sell is RERA registered.`,
  },
  {
    title: "Site visit policy",
    sourceType: "POLICY",
    content: `Site visits can be booked Monday to Saturday. Visit slots start every hour from 10:00 AM to 5:00 PM IST and each visit takes about one hour. Site visits are not available on Sundays or public holidays.

A relationship manager accompanies every visit. Each property can host one guided visit per time slot. Visits can be booked up to 60 days in advance.

Free pickup and drop within 10 km of the project can be arranged on request. To reschedule or cancel a visit, customers can call our office or ask the voice assistant; there is no cancellation charge.`,
  },
  {
    title: "Booking process and payment plans",
    sourceType: "POLICY",
    content: `To reserve a home, buyers pay a booking token of ₹1,00,000, which is fully refundable within 15 days. The token is adjusted against the booking amount.

Ready-to-move properties usually require 10% on agreement and the balance within 60 days or on loan disbursement. Under-construction projects offer construction-linked payment plans, typically 10% on booking, with the remainder linked to construction milestones.

Prices quoted are base prices. Stamp duty, registration charges, GST (5% on under-construction homes, not applicable on ready-to-move homes with occupancy certificate), parking and maintenance deposits are extra. Our sales team shares an exact cost sheet before booking.`,
  },
  {
    title: "Home loans",
    sourceType: "COMPANY_FAQ",
    content: `EstateAI works with several partner banks and housing finance companies that offer pre-approved loans on all our projects. Home loans of up to 80–90% of the property value are generally available depending on eligibility.

Our in-house loan desk helps with eligibility checks, documentation and faster sanction at no extra cost. Interest rates depend on the lender and the buyer's credit profile; we do not quote rates over the phone and recommend confirming the latest rate with the lender.`,
  },
  {
    title: "Pune locality guide",
    sourceType: "COMPANY_FAQ",
    content: `Baner: Upscale West Pune suburb with hills, cafés and offices. Well connected to Hinjewadi and Balewadi High Street. Popular with IT professionals and families.

Hinjewadi: Home to the Rajiv Gandhi Infotech Park, Pune's largest IT hub. Best for walk-to-work living and rental investment. Metro Line 3 is under construction.

Wakad: Residential hub between Hinjewadi and the Mumbai–Pune Expressway with good schools, hospitals and malls. Strong value for money.

Kharadi: East Pune's IT and financial district, close to the airport road and Koregaon Park. Strong rental demand from corporate tenants.

Balewadi: Next to Baner, known for Balewadi High Street's restaurants and the Shree Shiv Chhatrapati sports complex. Lifestyle-oriented neighbourhood.`,
  },
  {
    title: "RERA and documentation",
    sourceType: "POLICY",
    content: `All EstateAI projects are registered with MahaRERA. The RERA registration number is printed on every brochure and cost sheet, and buyers can verify it on the MahaRERA website.

Documents typically required to book: PAN card, Aadhaar card, two passport-size photographs and address proof. NRIs additionally need a passport copy and overseas address proof.`,
  },
];
