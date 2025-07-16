var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/eventTransformationService.ts
var eventTransformationService_exports = {};
__export(eventTransformationService_exports, {
  EventTransformationService: () => EventTransformationService,
  default: () => eventTransformationService_default
});
module.exports = __toCommonJS(eventTransformationService_exports);
var EventTransformationService = class {
  /**
   * Transform an API event to ChautauquaEvent format
   */
  static transformApiEvent(apiEvent) {
    const startDate = new Date(apiEvent.start_date);
    const endDate = new Date(apiEvent.end_date);
    return {
      // Core identifiers
      id: apiEvent.id,
      uid: this.generateBackwardCompatibleUid(apiEvent),
      // Event details
      title: apiEvent.title,
      description: apiEvent.description ? this.stripHtml(apiEvent.description) : void 0,
      startDate: apiEvent.start_date,
      endDate: apiEvent.end_date,
      timezone: apiEvent.timezone,
      // Location information
      venue: apiEvent.venue ? this.transformVenue(apiEvent.venue) : void 0,
      location: apiEvent.venue?.venue || "TBD",
      // Classification
      categories: apiEvent.categories.map((cat) => this.transformCategory(cat)),
      tags: this.generateTags(apiEvent),
      category: this.extractPrimaryCategory(apiEvent),
      // Metadata
      cost: apiEvent.cost || void 0,
      url: apiEvent.url || void 0,
      image: apiEvent.image ? this.transformImage(apiEvent.image) : void 0,
      status: apiEvent.status,
      featured: apiEvent.featured,
      // Legacy fields for backward compatibility
      dayOfWeek: startDate.getDay(),
      isRecurring: false,
      // Would need additional logic to detect
      recurrencePattern: void 0,
      audience: this.inferAudience(apiEvent),
      ticketRequired: this.inferTicketRequired(apiEvent),
      subcategory: this.extractSubcategory(apiEvent),
      series: this.extractSeries(apiEvent),
      presenter: this.extractPresenter(apiEvent),
      discipline: this.extractDiscipline(apiEvent),
      // System fields
      week: this.calculateWeek(startDate),
      confidence: this.assessConfidence(apiEvent),
      syncStatus: "synced",
      lastModified: (/* @__PURE__ */ new Date()).toISOString(),
      source: "events-calendar-api",
      // Dynamic data tracking
      lastUpdated: /* @__PURE__ */ new Date(),
      changeLog: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  /**
   * Transform multiple API events
   */
  static transformApiEvents(apiEvents) {
    return apiEvents.map((event) => this.transformApiEvent(event));
  }
  /**
   * Generate backward compatible UID
   */
  static generateBackwardCompatibleUid(apiEvent) {
    const date = new Date(apiEvent.start_date);
    const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
    const timeStr = date.toISOString().split("T")[1].replace(/[:.]/g, "").substring(0, 6);
    return `chq-${apiEvent.id}-${dateStr}T${timeStr}`;
  }
  /**
   * Transform venue object
   */
  static transformVenue(venue) {
    if (!venue) return void 0;
    return {
      id: venue.id,
      name: venue.venue,
      address: venue.address,
      showMap: venue.show_map
    };
  }
  /**
   * Transform category object
   */
  static transformCategory(category) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      taxonomy: category.taxonomy,
      parent: category.parent
    };
  }
  /**
   * Transform image object
   */
  static transformImage(image) {
    if (!image) return void 0;
    return {
      url: image.url,
      alt: image.alt,
      sizes: image.sizes
    };
  }
  /**
   * Generate tags from event data
   */
  static generateTags(apiEvent) {
    const tags = /* @__PURE__ */ new Set();
    if (apiEvent.venue?.venue) {
      tags.add(apiEvent.venue.venue.toLowerCase());
    }
    apiEvent.categories.forEach((cat) => {
      tags.add(cat.slug);
      tags.add(cat.name.toLowerCase());
    });
    const titleTags = this.extractTagsFromText(apiEvent.title);
    titleTags.forEach((tag) => tags.add(tag));
    if (apiEvent.description) {
      const descTags = this.extractTagsFromText(apiEvent.description);
      descTags.forEach((tag) => tags.add(tag));
    }
    if (apiEvent.cost) {
      if (apiEvent.cost.includes("$0") || apiEvent.cost.toLowerCase().includes("free")) {
        tags.add("free");
      } else {
        tags.add("ticketed");
      }
    }
    return Array.from(tags).filter((tag) => tag.length > 2);
  }
  /**
   * Extract tags from text using common patterns
   */
  static extractTagsFromText(text) {
    const tags = [];
    const cleanText = this.stripHtml(text).toLowerCase();
    const venueMap = {
      "amp": "amphitheater",
      "cso": "chautauqua symphony orchestra",
      "ctc": "chautauqua theater company",
      "clsc": "chautauqua literary and scientific circle",
      "ciwl": "chautauqua institution womens league",
      "hop": "hall of philosophy",
      "hoc": "hall of christ"
    };
    Object.entries(venueMap).forEach(([abbr, full]) => {
      if (cleanText.includes(abbr)) {
        tags.push(full);
      }
    });
    const eventTypes = [
      "lecture",
      "concert",
      "recital",
      "performance",
      "workshop",
      "service",
      "class",
      "meeting",
      "exhibition",
      "tour",
      "discussion",
      "presentation",
      "ceremony",
      "festival"
    ];
    eventTypes.forEach((type) => {
      if (cleanText.includes(type)) {
        tags.push(type);
      }
    });
    return tags;
  }
  /**
   * Extract primary category for backward compatibility
   */
  static extractPrimaryCategory(apiEvent) {
    if (apiEvent.categories.length === 0) return "General";
    const priorityCategories = [
      "Interfaith Lecture Series",
      "Morning Lecture",
      "Chautauqua Symphony Orchestra",
      "Chautauqua Theater Company",
      "Visual Arts",
      "Recreation",
      "Special Events"
    ];
    for (const priority of priorityCategories) {
      const found = apiEvent.categories.find(
        (cat) => cat.name.toLowerCase().includes(priority.toLowerCase())
      );
      if (found) return found.name;
    }
    return apiEvent.categories[0].name;
  }
  /**
   * Extract subcategory
   */
  static extractSubcategory(apiEvent) {
    const childCategories = apiEvent.categories.filter((cat) => cat.parent > 0);
    return childCategories.length > 0 ? childCategories[0].name : void 0;
  }
  /**
   * Extract series information
   */
  static extractSeries(apiEvent) {
    const title = apiEvent.title.toLowerCase();
    const description = apiEvent.description?.toLowerCase() || "";
    const seriesPatterns = [
      "morning lecture",
      "interfaith lecture",
      "porch discussion",
      "master class",
      "symphony concert",
      "chamber music",
      "sunday service"
    ];
    for (const pattern of seriesPatterns) {
      if (title.includes(pattern) || description.includes(pattern)) {
        return pattern.replace(/\b\w/g, (l) => l.toUpperCase());
      }
    }
    return void 0;
  }
  /**
   * Extract presenter information
   */
  static extractPresenter(apiEvent) {
    const title = apiEvent.title;
    const patterns = [
      /with\s+([^,\n]+)/i,
      /by\s+([^,\n]+)/i,
      /featuring\s+([^,\n]+)/i,
      /presenter:\s*([^,\n]+)/i,
      /speaker:\s*([^,\n]+)/i
    ];
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    return void 0;
  }
  /**
   * Extract discipline information
   */
  static extractDiscipline(apiEvent) {
    const categories = apiEvent.categories.map((cat) => cat.name.toLowerCase());
    const disciplineMap = {
      "music": "Music",
      "theater": "Theater",
      "lecture": "Education",
      "visual arts": "Visual Arts",
      "dance": "Dance",
      "literature": "Literature",
      "religion": "Religion",
      "philosophy": "Philosophy",
      "science": "Science"
    };
    for (const [key, value] of Object.entries(disciplineMap)) {
      if (categories.some((cat) => cat.includes(key))) {
        return value;
      }
    }
    return void 0;
  }
  /**
   * Infer audience type
   */
  static inferAudience(apiEvent) {
    const title = apiEvent.title.toLowerCase();
    const description = apiEvent.description?.toLowerCase() || "";
    const text = `${title} ${description}`;
    if (text.includes("children") || text.includes("kids") || text.includes("youth")) {
      return "children";
    }
    if (text.includes("family")) {
      return "family-friendly";
    }
    if (text.includes("adult") || text.includes("mature")) {
      return "adult-oriented";
    }
    return "all-ages";
  }
  /**
   * Infer if ticket is required
   */
  static inferTicketRequired(apiEvent) {
    if (!apiEvent.cost) return false;
    const cost = apiEvent.cost.toLowerCase();
    return !(cost.includes("$0") || cost.includes("free") || cost.includes("no charge"));
  }
  /**
   * Calculate Chautauqua week number
   */
  static calculateWeek(eventDate) {
    const year = eventDate.getFullYear();
    const june1 = new Date(year, 5, 1);
    const current = new Date(june1);
    let sundayCount = 0;
    let fourthSunday = null;
    while (current.getMonth() === 5) {
      if (current.getDay() === 0) {
        sundayCount++;
        if (sundayCount === 4) {
          fourthSunday = new Date(current);
          break;
        }
      }
      current.setDate(current.getDate() + 1);
    }
    if (!fourthSunday) {
      console.warn(`Could not find 4th Sunday of June ${year}`);
      return 1;
    }
    const timeDiff = eventDate.getTime() - fourthSunday.getTime();
    const weekNumber = Math.floor(timeDiff / (7 * 24 * 60 * 60 * 1e3)) + 1;
    return Math.max(1, Math.min(9, weekNumber));
  }
  /**
   * Assess confidence level
   */
  static assessConfidence(apiEvent) {
    const title = apiEvent.title.toLowerCase();
    const description = apiEvent.description?.toLowerCase() || "";
    if (title.includes("tba") || title.includes("to be announced") || description.includes("tba") || description.includes("to be announced")) {
      return "TBA";
    }
    if (title.includes("tentative") || description.includes("tentative")) {
      return "tentative";
    }
    if (title.includes("placeholder") || description.includes("placeholder")) {
      return "placeholder";
    }
    return "confirmed";
  }
  /**
   * Strip HTML tags from text
   */
  static stripHtml(html) {
    return html.replace(/<[^>]*>/g, "").trim();
  }
};
var eventTransformationService_default = EventTransformationService;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EventTransformationService
});
