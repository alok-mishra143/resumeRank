import { describe, expect, it } from "vitest"
import { parseEducationEntry, parseExperience, proposeContact } from "../src/extract/deterministic"

// These shapes come from real public resumes (GitHub CVs and university sample
// resumes) that broke an earlier version of the parser.

describe("contact extraction on real layouts", () => {
  it("keeps a name that carries credentials", () => {
    const text = ["SAMMY SPARTAN, RN, BSN", "www.linkedin.com/in/yoururlhere • 727-277-9009 • email@ut.edu • Tampa, FL", "Registered Nurse with 10 years of experience."].join("\n")
    const c = proposeContact(text)
    expect(c.fullName).toBe("SAMMY SPARTAN")
  })

  it("handles 'Name | Title' headers", () => {
    const c = proposeContact("Jane Doe | Backend Engineer\njane@example.com\nSan Francisco, CA")
    expect(c.fullName).toBe("Jane Doe")
  })

  it("finds a location on a combined contact line", () => {
    const c = proposeContact("ROBBY HORVATH\nrobbyshorvath@gmail.com • 737-610-5589 • New York, NY\nEXPERIENCE")
    expect(c.location).toBe("New York, NY")
  })

  it("strips a Location label without a colon", () => {
    const c = proposeContact("DEVON OKAFOR\nLocation London, UK\ndevon@example.com")
    expect(c.location).toBe("London, UK")
  })
})

describe("education parsing", () => {
  it("splits a degree line with no comma", () => {
    const e = parseEducationEntry("B.Eng. Software Engineering Imperial College London (2016)")
    expect(e.school).toBe("Imperial College London")
    expect(e.degree.toLowerCase()).toContain("b.eng")
    expect(e.field).toBe("Software Engineering")
    expect(e.endYear).toBe("2016")
  })

  it("splits the label form the proposer emits", () => {
    const e = parseEducationEntry("Bachelor's, Northwind University (2015)")
    expect(e.school).toBe("Northwind University")
    expect(e.degree.toLowerCase()).toContain("bachelor")
    expect(e.endYear).toBe("2015")
  })

  it("reads a dash-separated masters line with a range", () => {
    const e = parseEducationEntry("M.Sc. Computer Science - Technical University of Munich - 2015 - 2017")
    expect(e.school).toBe("Technical University of Munich")
    expect(e.field).toBe("Computer Science")
    expect(e.startYear).toBe("2015")
    expect(e.endYear).toBe("2017")
  })

  it("never repeats the degree as the field", () => {
    for (const line of ["B.S. Computer Science, University of Washington, 2014", "MBA, Harvard Business School (2018)"]) {
      const e = parseEducationEntry(line)
      expect(e.field.toLowerCase()).not.toBe(e.degree.toLowerCase())
    }
  })
})

describe("experience parsing on real layouts", () => {
  const parse = (lines: string[]) => parseExperience(lines.join("\n"))

  it("reads 'Role - Company Month YYYY – Month YYYY' and keeps prose bullets off the title", () => {
    const [first, second] = parse([
      "EXPERIENCE",
      "Software Engineer - Sweetspot July 2025 – April 2026",
      "Built core product capabilities for an AI-native platform spanning agent workflows",
      "DevOps Engineer - Anatomy Financial October 2024 – July 2025",
      "Improved product quality by streamlining release candidate workflows",
    ])
    expect(first.role).toBe("Software Engineer")
    expect(first.company).toBe("Sweetspot")
    expect(second.role).toBe("DevOps Engineer")
    expect(second.company).toBe("Anatomy Financial")
    expect(first.bullets.length).toBeGreaterThan(0)
  })

  it("reads 'Role, Company (dates)'", () => {
    const [e] = parse(["WORK EXPERIENCE", "Senior Backend Engineer, Northwind Cloud (Jan 2019 – Present)", "Owned services."])
    expect(e.role).toBe("Senior Backend Engineer")
    expect(e.company).toBe("Northwind Cloud")
    expect(e.isCurrent).toBe(true)
  })

  it("reads 'Company — Role'", () => {
    const [e] = parse(["PROFESSIONAL EXPERIENCE", "Google — Senior Software Engineer 2020 - 2023", "Search infrastructure."])
    expect(e.company).toBe("Google")
    expect(e.role).toBe("Senior Software Engineer")
  })

  it("reads a pipe-separated line", () => {
    const [e] = parse(["EXPERIENCE", "QA Engineer | Zephyr Labs | 2018 - 2021", "Test suites."])
    expect(e.company).toBe("Zephyr Labs")
    expect(e.role).toBe("QA Engineer")
  })

  it("reads title on one line, company+city on the next", () => {
    const [e] = parse(["EXPERIENCE", "Senior Software Engineer", "Stripe, San Francisco, CA", "Jan 2020 – Present", "Payments work."])
    expect(e.role).toBe("Senior Software Engineer")
    expect(e.company).toBe("Stripe")
    expect(e.startDate).toBe("2020-01")
  })
})

describe("location guards (false positives are worse than misses)", () => {
  it("does not mistake a name for a location", () => {
    const c = proposeContact("Nina Nursing, R.N.\n1234 Care Street, Coon Rapids, MN 55433 ninanursing@gmail.com (763) 555-5555")
    expect(c.location).toBe("Coon Rapids, MN")
  })

  it("does not mistake a college for a location", () => {
    const c = proposeContact("NIKITA DWIVEDI\nnikita@example.com\nVNIT, NAGPUR\nB.Tech Computer Science")
    expect(c.location).toBe("")
  })

  it("does not mistake an employer line for a location", () => {
    const c = proposeContact("YANG\nhello@example.com\nMezzanotte Labs Remote (Seasonal)\nBachelor of Science in Computer Science")
    expect(c.location).toBe("")
  })

  it("rejects template placeholders", () => {
    const c = proposeContact("Street | City State, Zip | Phone | Email")
    expect(c.location).toBe("")
  })

  it("reads a dot-leader contact line", () => {
    const c = proposeContact("ROBBY HORVATH\nrhorv@proton.me ․ horv.co ․ Philadelphia, PA")
    expect(c.location).toBe("Philadelphia, PA")
  })

  it("reads a standalone three-part line", () => {
    const c = proposeContact("Tin Htet Kyaw\nMillbrae, California, USA\ntin@example.com")
    expect(c.location).toBe("Millbrae, California")
  })

  it("leaves it empty when the resume only has locations inside experience", () => {
    const c = proposeContact("KIRTHI SIVAMANI\nk@example.com\nPurdue University, West Lafayette, IN Aug 2017-May 2021")
    expect(c.location).toBe("")
  })
})
