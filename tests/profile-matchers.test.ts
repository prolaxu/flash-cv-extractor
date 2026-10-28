import { describe, it, expect } from "vitest";
import {
  matchEmail,
  matchPhone,
  matchUrl,
  matchCityAndState,
  matchCityAndCountry,
} from "../src/extract/profile";
import type { TextItem } from "../src/types";

const makeTextItem = (text: string) => ({ text } as TextItem);
const match = (
  matcher: (item: TextItem) => RegExpMatchArray | null,
  text: string
) => matcher(makeTextItem(text))?.[0];

describe("email matching - ", () => {
  it("keeps a plain address intact", () => {
    expect(match(matchEmail, "  hello@open-resume.org  ")).toBe(
      "hello@open-resume.org"
    );
  });

  it("does not truncate a .com to .co", () => {
    expect(match(matchEmail, "nabinduwadi8@gmail.com")).toBe(
      "nabinduwadi8@gmail.com"
    );
  });

  it("stops at a separator glyph used to pack a contact line", () => {
    expect(
      match(
        matchEmail,
        "9849501483⋄itsmesureshtamang@gmail.com⋄linkedin.com/in/x"
      )
    ).toBe("itsmesureshtamang@gmail.com");
  });

  it("cuts a url glued straight onto the address", () => {
    expect(
      match(matchEmail, "nabinacharya740@gmail.comhttps://www.linkedin.com/in/x")
    ).toBe("nabinacharya740@gmail.com");
  });

  it("drops trailing punctuation", () => {
    expect(match(matchEmail, "someone@example.org.")).toBe(
      "someone@example.org"
    );
  });

  it("preserves a multi part tld", () => {
    expect(match(matchEmail, "a.b@dept.example.co.uk")).toBe(
      "a.b@dept.example.co.uk"
    );
  });
});

describe("phone matching - ", () => {
  it("matches the us shape", () => {
    expect(match(matchPhone, "  (123)456-7890  ")).toBe("(123)456-7890");
  });

  it("keeps an international number whole", () => {
    expect(match(matchPhone, "+977-9867086370")).toBe("+977-9867086370");
    expect(match(matchPhone, "+977 986-7481189")).toBe("+977 986-7481189");
  });

  it("matches a bare 10 digit number next to a separator", () => {
    expect(match(matchPhone, "9849501483⋄me@gmail.com")).toBe(
      "9849501483"
    );
  });

  it("does not mistake a year range for a phone number", () => {
    expect(matchPhone(makeTextItem("2020 - 2023"))).toBeNull();
    expect(matchPhone(makeTextItem("2020-2023"))).toBeNull();
    expect(matchPhone(makeTextItem("March 2022 - April 2026"))).toBeNull();
  });

  it("ignores a number that is too short to be a phone number", () => {
    expect(matchPhone(makeTextItem("GPA 3.85"))).toBeNull();
  });
});

describe("url matching - ", () => {
  it("matches a bare url", () => {
    expect(match(matchUrl, "  linkedin.com/in/open-resume  ")).toBe(
      "linkedin.com/in/open-resume"
    );
  });

  it("does not treat an email as a url", () => {
    expect(matchUrl(makeTextItem("hello@open-resume.org"))).toBeFalsy();
  });

  it("stops at a separator glyph", () => {
    expect(
      match(matchUrl, "me@gmail.com⋄linkedin.com/in/sureshtamang23")
    ).toBe("linkedin.com/in/sureshtamang23");
  });
});

describe("location matching - ", () => {
  it("matches city and state", () => {
    expect(match(matchCityAndState, "San Francisco, CA")).toBe(
      "San Francisco, CA"
    );
  });

  it("does not match a comma inside a sentence", () => {
    expect(
      matchCityAndState(
        makeTextItem("and Laravel. Strong foundation in OOP, RESTful API design")
      )
    ).toBeNull();
  });

  it("matches a city and country outside the us", () => {
    expect(match(matchCityAndCountry, "Bhaktapur, Radhe Radhe")).toBe(
      "Bhaktapur, Radhe Radhe"
    );
    expect(
      match(matchCityAndCountry, "Koteshwor Kathmandu, Bagmati, Nepal.")
    ).toBe("Koteshwor Kathmandu, Bagmati, Nepal.");
  });

  it("does not match a prose sentence", () => {
    expect(
      matchCityAndCountry(
        makeTextItem("Developed dynamic interfaces using Laravel, Vue.js")
      )
    ).toBeNull();
  });
});
