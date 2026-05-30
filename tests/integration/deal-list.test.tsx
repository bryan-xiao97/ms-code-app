import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealList } from "@/components/deal/DealList";

describe("DealList", () => {
  it("renders empty state", () => {
    render(<DealList deals={[]} />);
    expect(screen.getByText(/no deals yet/i)).toBeInTheDocument();
  });

  it("renders deals with stage label", () => {
    render(
      <DealList
        deals={[
          {
            id: "d1",
            name: "Project Alpha",
            target_company: "AlphaCo",
            sector: "SaaS",
            stage: "marketing_cim",
          },
        ]}
      />
    );
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText(/AlphaCo · SaaS/)).toBeInTheDocument();
    expect(screen.getByText("Marketing / CIM")).toBeInTheDocument();
  });
});
