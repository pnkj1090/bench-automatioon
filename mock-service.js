// Mock Database and Service Layer
import { getInitialMockDemands } from './mock-data.js';
import { CONFIG } from './config.js';

class MockService {
  constructor() {
    this.demands = getInitialMockDemands();
    this.submissions = [];
  }

  reset() {
    this.demands = getInitialMockDemands();
    this.submissions = [];
    return { status: 'reset', count: this.demands.length };
  }

  getFilterMetadata() {
    return {
      genus: CONFIG.filters.genus,
      location: [
        "India - Gurugram, Haryana, India - WFA",
        "India - Bengaluru, Karnataka, India - WFA",
        "India - Noida, Uttar Pradesh, India - WFA"
      ]
    };
  }

  fetchDemands(filters = {}) {
    let results = [...this.demands];

    // Filter by Genus if specified
    if (filters.genus && Array.isArray(filters.genus) && filters.genus.length > 0) {
      results = results.filter(d => filters.genus.includes(d.genus));
    }

    // Filter by Location if specified
    if (filters.location && Array.isArray(filters.location) && filters.location.length > 0) {
      results = results.filter(d => filters.location.includes(d.location));
    }

    return {
      content: results,
      totalRecords: results.length,
      totalPages: 1,
      pageNumber: 1,
      pageSize: results.length
    };
  }

  uploadResume(identifier, fileName) {
    const fakeFileName = fileName || `resume_${identifier}_${Date.now()}.pdf`;
    return {
      fileName: fakeFileName,
      status: 'success',
      message: 'Resume uploaded successfully'
    };
  }

  submitInterest(demandId, payload = {}) {
    const demand = this.demands.find(d => (d.demandId === demandId || d.id === demandId));
    if (!demand) {
      throw new Error(`Demand ${demandId} not found`);
    }

    demand.interested = true;
    demand.interestCount = (demand.interestCount || 0) + 1;

    const record = {
      demandId,
      timestamp: new Date().toISOString(),
      candidateComments: payload.candidateComments,
      fileName: payload.fileName,
      additionalSkills: payload.additionalSkills
    };
    this.submissions.push(record);

    return {
      status: 'success',
      message: 'Interest recorded successfully',
      interestCount: demand.interestCount
    };
  }

  addTestDemand(data = {}) {
    const newId = `DEM-${Math.floor(10000 + Math.random() * 90000)}`;
    const newDemand = {
      demandId: newId,
      genus: data.genus || "3.1-FRONTEND-REACT",
      businessUnit: data.businessUnit || "New Opportunity Hub",
      location: data.location || "India - Gurugram, Haryana, India - WFA",
      jobDescription: data.jobDescription || "Dynamically injected demand to test automation.",
      additionalSkills: data.additionalSkills || ["React", "TypeScript"],
      interestCount: 0,
      interested: false,
      country: "India",
      createdAt: new Date().toISOString()
    };
    this.demands.unshift(newDemand);
    return newDemand;
  }
}

export const mockService = new MockService();
