// Furniture library. Each entry is a placeholder the user drops on the photo.
// `shape` picks the silhouette drawn on the layout guide, `w` is the default
// width as a fraction of the photo width, `aspect` is width / height, and
// `prompt` is what the model is told to render in that spot.

export const CATEGORIES = ["Living", "Dining", "Bedroom", "Office", "Kitchen", "Decor", "Lighting", "Outdoor"];

export const LIBRARY = [
  // Living
  { id: "sofa-3", name: "Sofa, 3 seat", category: "Living", shape: "sofa", w: 0.34, aspect: 2.6, prompt: "three-seat sofa" },
  { id: "sofa-2", name: "Sofa, 2 seat", category: "Living", shape: "sofa", w: 0.26, aspect: 2.1, prompt: "two-seat loveseat sofa" },
  { id: "sectional", name: "Corner sectional", category: "Living", shape: "sectional", w: 0.42, aspect: 2.4, prompt: "L-shaped corner sectional sofa" },
  { id: "armchair", name: "Armchair", category: "Living", shape: "chair", w: 0.13, aspect: 1.0, prompt: "upholstered armchair" },
  { id: "accent-chair", name: "Accent chair", category: "Living", shape: "chair", w: 0.11, aspect: 0.9, prompt: "accent lounge chair" },
  { id: "ottoman", name: "Ottoman", category: "Living", shape: "ottoman", w: 0.09, aspect: 1.6, prompt: "upholstered ottoman" },
  { id: "coffee-table", name: "Coffee table", category: "Living", shape: "lowTable", w: 0.2, aspect: 3.2, prompt: "coffee table" },
  { id: "coffee-round", name: "Round coffee table", category: "Living", shape: "roundTable", w: 0.14, aspect: 2.8, prompt: "round coffee table" },
  { id: "side-table", name: "Side table", category: "Living", shape: "table", w: 0.06, aspect: 0.9, prompt: "small side table" },
  { id: "tv-unit", name: "TV console", category: "Living", shape: "cabinet", w: 0.28, aspect: 4.0, prompt: "low TV console with a wall-mounted TV above" },
  { id: "bookshelf", name: "Bookshelf", category: "Living", shape: "shelf", w: 0.12, aspect: 0.45, prompt: "tall bookshelf styled with books and objects" },
  { id: "rug", name: "Rug", category: "Living", shape: "rug", w: 0.4, aspect: 3.6, prompt: "large area rug lying flat on the floor" },

  // Dining
  { id: "dining-rect", name: "Dining table", category: "Dining", shape: "table", w: 0.3, aspect: 2.4, prompt: "rectangular dining table" },
  { id: "dining-round", name: "Round dining table", category: "Dining", shape: "roundTable", w: 0.18, aspect: 1.6, prompt: "round dining table" },
  { id: "dining-set", name: "Dining set (table + chairs)", category: "Dining", shape: "diningSet", w: 0.34, aspect: 2.0, prompt: "dining table with matching chairs around it" },
  { id: "dining-chair", name: "Dining chair", category: "Dining", shape: "diningChair", w: 0.06, aspect: 0.55, prompt: "dining chair" },
  { id: "sideboard", name: "Sideboard", category: "Dining", shape: "cabinet", w: 0.24, aspect: 2.8, prompt: "sideboard buffet cabinet" },
  { id: "bar-stool", name: "Bar stool", category: "Dining", shape: "stool", w: 0.05, aspect: 0.5, prompt: "bar stool" },

  // Bedroom
  { id: "bed-king", name: "King bed", category: "Bedroom", shape: "bed", w: 0.4, aspect: 1.5, prompt: "king bed with headboard, made with layered bedding and pillows" },
  { id: "bed-queen", name: "Queen bed", category: "Bedroom", shape: "bed", w: 0.34, aspect: 1.45, prompt: "queen bed with headboard, made with layered bedding and pillows" },
  { id: "bed-single", name: "Single bed", category: "Bedroom", shape: "bed", w: 0.2, aspect: 1.0, prompt: "single bed with headboard and neat bedding" },
  { id: "bedside", name: "Bedside table", category: "Bedroom", shape: "cabinet", w: 0.07, aspect: 1.0, prompt: "bedside table with a small lamp" },
  { id: "dresser", name: "Dresser", category: "Bedroom", shape: "cabinet", w: 0.18, aspect: 1.6, prompt: "chest of drawers" },
  { id: "wardrobe", name: "Wardrobe", category: "Bedroom", shape: "wardrobe", w: 0.18, aspect: 0.55, prompt: "freestanding wardrobe" },
  { id: "bed-bench", name: "End of bed bench", category: "Bedroom", shape: "ottoman", w: 0.2, aspect: 3.5, prompt: "upholstered bench at the foot of the bed" },

  // Office
  { id: "desk", name: "Desk", category: "Office", shape: "desk", w: 0.2, aspect: 1.8, prompt: "writing desk" },
  { id: "office-chair", name: "Office chair", category: "Office", shape: "chair", w: 0.08, aspect: 0.75, prompt: "office desk chair" },
  { id: "filing", name: "Low storage", category: "Office", shape: "cabinet", w: 0.12, aspect: 1.4, prompt: "low storage cabinet" },

  // Kitchen
  { id: "stools-row", name: "Row of stools", category: "Kitchen", shape: "stoolRow", w: 0.24, aspect: 1.6, prompt: "row of matching counter stools tucked under the bench" },
  { id: "bench-styling", name: "Benchtop styling", category: "Kitchen", shape: "decor", w: 0.18, aspect: 2.2, prompt: "minimal benchtop styling: a bowl of fruit, a vase and a chopping board" },

  // Decor
  { id: "plant-large", name: "Large plant", category: "Decor", shape: "plant", w: 0.08, aspect: 0.5, prompt: "large indoor plant in a planter" },
  { id: "plant-small", name: "Small plant", category: "Decor", shape: "plant", w: 0.04, aspect: 0.7, prompt: "small potted plant" },
  { id: "artwork", name: "Wall art", category: "Decor", shape: "art", w: 0.16, aspect: 1.3, prompt: "framed artwork hung on the wall" },
  { id: "mirror", name: "Mirror", category: "Decor", shape: "mirror", w: 0.08, aspect: 0.6, prompt: "wall mirror" },
  { id: "decor", name: "Styling objects", category: "Decor", shape: "decor", w: 0.08, aspect: 1.4, prompt: "a few styling objects such as books, a vase and a candle" },
  { id: "curtains", name: "Curtains", category: "Decor", shape: "curtain", w: 0.1, aspect: 0.35, prompt: "floor-length sheer curtains" },

  // Lighting
  { id: "floor-lamp", name: "Floor lamp", category: "Lighting", shape: "floorLamp", w: 0.05, aspect: 0.3, prompt: "floor lamp" },
  { id: "table-lamp", name: "Table lamp", category: "Lighting", shape: "tableLamp", w: 0.04, aspect: 0.7, prompt: "table lamp" },
  { id: "pendant", name: "Pendant light", category: "Lighting", shape: "pendant", w: 0.08, aspect: 0.8, prompt: "pendant light hanging from the ceiling" },

  // Outdoor
  { id: "outdoor-lounge", name: "Outdoor lounge", category: "Outdoor", shape: "sofa", w: 0.3, aspect: 2.4, prompt: "outdoor lounge sofa with weatherproof cushions" },
  { id: "outdoor-dining", name: "Outdoor dining set", category: "Outdoor", shape: "diningSet", w: 0.3, aspect: 2.0, prompt: "outdoor dining table and chairs" },
  { id: "sun-lounger", name: "Sun lounger", category: "Outdoor", shape: "lounger", w: 0.2, aspect: 2.6, prompt: "sun lounger" },
  { id: "umbrella", name: "Market umbrella", category: "Outdoor", shape: "umbrella", w: 0.2, aspect: 0.9, prompt: "outdoor market umbrella" },
  { id: "planter", name: "Outdoor planter", category: "Outdoor", shape: "plant", w: 0.07, aspect: 0.6, prompt: "outdoor planter with greenery" },

  // Anything else
  { id: "custom", name: "Custom item", category: "Decor", shape: "box", w: 0.12, aspect: 1.2, prompt: "" },
];

export const SHAPES = [
  "box", "sofa", "sectional", "chair", "diningChair", "ottoman", "lowTable", "roundTable", "table", "diningSet",
  "desk", "cabinet", "shelf", "wardrobe", "bed", "rug", "plant", "art", "mirror", "decor", "curtain",
  "floorLamp", "tableLamp", "pendant", "stool", "stoolRow", "lounger", "umbrella",
];

export const STYLES = [
  "Contemporary", "Scandinavian", "Modern coastal", "Hamptons", "Japandi", "Mid-century modern",
  "Modern farmhouse", "Industrial", "Luxury modern", "Minimalist", "Traditional", "Bohemian",
];

export const ROOM_TYPES = [
  "Living room", "Dining room", "Open plan living and dining", "Bedroom", "Main bedroom", "Kids bedroom",
  "Home office", "Kitchen", "Alfresco / patio", "Balcony", "Entry", "Media room",
];

// High-contrast placeholder colours. The prompt names each colour so the
// model can match the text to the shape.
export const PALETTE = [
  { name: "red", hex: "#e5343d" },
  { name: "blue", hex: "#2f6fe4" },
  { name: "green", hex: "#1fa855" },
  { name: "orange", hex: "#f28c18" },
  { name: "purple", hex: "#8e44d6" },
  { name: "cyan", hex: "#12b5c9" },
  { name: "magenta", hex: "#e03fa8" },
  { name: "yellow", hex: "#e8c11c" },
  { name: "brown", hex: "#8a5a2b" },
  { name: "lime", hex: "#8cc919" },
  { name: "navy", hex: "#23357a" },
  { name: "pink", hex: "#f58fb0" },
];
