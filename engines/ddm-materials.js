/* =====================================================================
   DDM CREATION SYSTEM · MATERIAL RECORDS  (v0.5.0, calibration v0)
   One record per surface: look (color), sound slot and contact behavior together.
   Generated from ddm-contact-materials-v0.4.0.json; see the Contact Engine Reference v0.2.
   v0.5.0 adds the Putt Lab surfaces (lab turf, polished concrete, rock) and the layered
   element materials: a core (bark, bush stem, stuffed body, steel, concrete), a mid layer
   that gives and flexes (branches, twigs, plush skin) and a porous outer layer the disc
   travels through (leaves, dense bush leaves, fur: drag, deflection, spin loss, and the
   chance it hangs up in there). All estimates; tune in play.
   v0.4.0 adds moat water (a water surface: a flat, fast, shallow disc can skip; anything
   else splashes and sinks), the hedge-top surface and the hedge solid.
   v0.3.0 adds the Castle Hall surfaces (turf, tennis court, flagstone, wood deck, gold coins,
   royal carpet) and solids (stone, armor, hay, net, zombie clown, timber, banner cloth).
   New values are estimates by analogy with the v0.2 records; tune them in playtesting.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDMMaterials = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
  "version": "0.5.0",
  "tombstoneMaxDepthIn": 4.0,
  "surfaces": {
    "asphalt": {
      "slideFriction": 0.3,
      "skipRetention": 0.8,
      "restitution": 0.45,
      "grassDrag": 0.0,
      "edgeGrab": 0.02,
      "rollResistance": 0.015,
      "sound": "contact.hard",
      "embed": 0,
      "look": "#3b3f43",
      "label": "Asphalt"
    },
    "concrete": {
      "slideFriction": 0.32,
      "skipRetention": 0.8,
      "restitution": 0.45,
      "grassDrag": 0.0,
      "edgeGrab": 0.02,
      "rollResistance": 0.015,
      "sound": "contact.hard",
      "embed": 0,
      "look": "#bdbab2",
      "label": "Concrete"
    },
    "hardpack_dirt": {
      "slideFriction": 0.4,
      "skipRetention": 0.72,
      "restitution": 0.35,
      "grassDrag": 0.2,
      "edgeGrab": 0.08,
      "rollResistance": 0.03,
      "sound": "contact.dirt",
      "embed": 0.05,
      "look": "#a98a62",
      "label": "Hardpack dirt"
    },
    "short_grass_dry": {
      "slideFriction": 0.55,
      "skipRetention": 0.65,
      "restitution": 0.25,
      "grassDrag": 1.2,
      "edgeGrab": 0.12,
      "rollResistance": 0.05,
      "sound": "contact.grass",
      "embed": 0.1,
      "look": "#6cc25a",
      "label": "Short grass"
    },
    "short_grass_wet": {
      "slideFriction": 0.4,
      "skipRetention": 0.55,
      "restitution": 0.15,
      "grassDrag": 0.9,
      "edgeGrab": 0.15,
      "rollResistance": 0.06,
      "sound": "contact.grass_wet",
      "embed": 0.25,
      "look": "#4f9e47",
      "label": "Short grass, wet"
    },
    "gravel": {
      "slideFriction": 0.6,
      "skipRetention": 0.55,
      "restitution": 0.3,
      "grassDrag": 0.8,
      "edgeGrab": 0.15,
      "rollResistance": 0.09,
      "sound": "contact.gravel",
      "embed": 0.0,
      "look": "#9b958b",
      "label": "Gravel"
    },
    "wood_chips": {
      "slideFriction": 0.65,
      "skipRetention": 0.45,
      "restitution": 0.15,
      "grassDrag": 1.2,
      "edgeGrab": 0.25,
      "rollResistance": 0.12,
      "sound": "contact.chips",
      "embed": 0.2,
      "look": "#a0683a",
      "label": "Wood chips"
    },
    "medium_grass_wet": {
      "slideFriction": 0.85,
      "skipRetention": 0.25,
      "restitution": 0.08,
      "grassDrag": 2.5,
      "edgeGrab": 0.5,
      "rollResistance": 0.25,
      "sound": "contact.grass_wet",
      "embed": 0.5,
      "look": "#3f7f3a",
      "label": "Medium grass, wet"
    },
    "deep_grass": {
      "slideFriction": 0.95,
      "skipRetention": 0.15,
      "restitution": 0.05,
      "grassDrag": 3.5,
      "edgeGrab": 0.6,
      "rollResistance": 0.35,
      "sound": "contact.grass_deep",
      "embed": 0.3,
      "look": "#3a7334",
      "label": "Deep grass"
    },
    "mud": {
      "slideFriction": 1.1,
      "skipRetention": 0.05,
      "restitution": 0.02,
      "grassDrag": 3.5,
      "edgeGrab": 0.8,
      "rollResistance": 0.5,
      "sound": "contact.mud",
      "embed": 1.0,
      "look": "#5a4330",
      "label": "Mud"
    },
    "artificial_turf": {
      "slideFriction": 0.5,
      "skipRetention": 0.7,
      "restitution": 0.28,
      "grassDrag": 0.9,
      "edgeGrab": 0.1,
      "rollResistance": 0.04,
      "sound": "contact.grass",
      "embed": 0.05,
      "look": "#3f9a4c",
      "label": "Artificial turf"
    },
    "tennis_court": {
      "slideFriction": 0.42,
      "skipRetention": 0.75,
      "restitution": 0.42,
      "grassDrag": 0.0,
      "edgeGrab": 0.03,
      "rollResistance": 0.018,
      "sound": "contact.hard",
      "embed": 0,
      "look": "#3d6fa8",
      "label": "Tennis court"
    },
    "flagstone": {
      "slideFriction": 0.38,
      "skipRetention": 0.72,
      "restitution": 0.5,
      "grassDrag": 0.0,
      "edgeGrab": 0.06,
      "rollResistance": 0.03,
      "sound": "contact.rock",
      "embed": 0,
      "look": "#8f8a80",
      "label": "Flagstone"
    },
    "wood_deck": {
      "slideFriction": 0.35,
      "skipRetention": 0.75,
      "restitution": 0.4,
      "grassDrag": 0.0,
      "edgeGrab": 0.04,
      "rollResistance": 0.02,
      "sound": "contact.wood",
      "embed": 0,
      "look": "#9a6b3f",
      "label": "Wood deck"
    },
    "gold_coins": {
      "slideFriction": 0.7,
      "skipRetention": 0.4,
      "restitution": 0.25,
      "grassDrag": 1.0,
      "edgeGrab": 0.2,
      "rollResistance": 0.12,
      "sound": "contact.gravel",
      "embed": 0.1,
      "look": "#d8b23a",
      "label": "Gold coins"
    },
    "royal_carpet": {
      "slideFriction": 0.75,
      "skipRetention": 0.3,
      "restitution": 0.1,
      "grassDrag": 1.5,
      "edgeGrab": 0.3,
      "rollResistance": 0.2,
      "sound": "contact.grass_deep",
      "embed": 0.05,
      "look": "#a3263a",
      "label": "Royal carpet"
    },
    "hedge_top": {
      "slideFriction": 0.9,
      "skipRetention": 0.1,
      "restitution": 0.06,
      "grassDrag": 3.0,
      "edgeGrab": 0.5,
      "rollResistance": 0.4,
      "sound": "contact.grass_deep",
      "embed": 0.3,
      "look": "#2f6b34",
      "label": "Hedge top"
    },
    "moat_water": {
      "water": true,
      "slideFriction": 1.0,
      "skipRetention": 0.6,
      "restitution": 0.35,
      "grassDrag": 0.0,
      "edgeGrab": 0.0,
      "rollResistance": 1.0,
      "sound": "contact.splash",
      "embed": 0,
      "look": "#2d6f9e",
      "label": "Moat water"
    },
    "lab_turf": {
      "slideFriction": 0.48,
      "skipRetention": 0.7,
      "restitution": 0.3,
      "grassDrag": 0.8,
      "edgeGrab": 0.08,
      "rollResistance": 0.04,
      "sound": "contact.grass",
      "embed": 0.04,
      "look": "#10302c",
      "label": "Lab turf"
    },
    "lab_concrete": {
      "slideFriction": 0.3,
      "skipRetention": 0.8,
      "restitution": 0.46,
      "grassDrag": 0.0,
      "edgeGrab": 0.02,
      "rollResistance": 0.015,
      "sound": "contact.hard",
      "embed": 0,
      "look": "#4c535c",
      "label": "Polished concrete"
    },
    "rock_slab": {
      "slideFriction": 0.42,
      "skipRetention": 0.7,
      "restitution": 0.52,
      "grassDrag": 0.0,
      "edgeGrab": 0.1,
      "rollResistance": 0.04,
      "sound": "contact.rock",
      "embed": 0,
      "look": "#6e6259",
      "label": "Rock"
    }
  },
  "solids": {
    "tree_bark": {
      "restitution": 0.35,
      "friction": 0.6,
      "sound": "contact.wood",
      "label": "Tree"
    },
    "rock": {
      "restitution": 0.55,
      "friction": 0.45,
      "sound": "contact.rock",
      "label": "Rock"
    },
    "wood_post": {
      "restitution": 0.4,
      "friction": 0.5,
      "sound": "contact.wood",
      "label": "Post"
    },
    "metal": {
      "restitution": 0.5,
      "friction": 0.25,
      "sound": "contact.metal",
      "label": "Metal"
    },
    "brick_wall": {
      "restitution": 0.5,
      "friction": 0.5,
      "sound": "contact.hard",
      "label": "Brick"
    },
    "stone": {
      "restitution": 0.5,
      "friction": 0.5,
      "sound": "contact.rock",
      "label": "Castle stone"
    },
    "armor": {
      "restitution": 0.55,
      "friction": 0.25,
      "sound": "contact.metal",
      "label": "Suit of armor"
    },
    "hay": {
      "restitution": 0.08,
      "friction": 0.9,
      "sound": "contact.chips",
      "label": "Hay bale"
    },
    "net": {
      "restitution": 0.05,
      "friction": 0.95,
      "sound": "contact.grass_deep",
      "label": "Net"
    },
    "zombie": {
      "restitution": 0.15,
      "friction": 0.7,
      "sound": "contact.mud",
      "label": "Zombie clown"
    },
    "timber": {
      "restitution": 0.4,
      "friction": 0.5,
      "sound": "contact.wood",
      "label": "Timber"
    },
    "cloth": {
      "restitution": 0.04,
      "friction": 0.95,
      "sound": "contact.grass_deep",
      "label": "Banner"
    },
    "hedge": {
      "restitution": 0.1,
      "friction": 0.9,
      "sound": "contact.grass_deep",
      "label": "Hedge"
    },
    "bark_core": {
      "restitution": 0.4,
      "friction": 0.55,
      "sound": "contact.wood",
      "label": "Tree trunk",
      "layer": "core"
    },
    "branch": {
      "restitution": 0.3,
      "friction": 0.7,
      "give": 0.35,
      "flex": 0.35,
      "sound": "contact.branch",
      "label": "Branches",
      "layer": "mid"
    },
    "leaves": {
      "porous": {
        "drag": 7,
        "deflect": 0.9,
        "spinDrag": 3,
        "catchSpeed": 2.2,
        "hold": 0.55
      },
      "sound": "contact.leaves",
      "label": "Leaves",
      "layer": "outer"
    },
    "shrub_core": {
      "restitution": 0.3,
      "friction": 0.6,
      "sound": "contact.wood",
      "label": "Bush stem",
      "layer": "core"
    },
    "twig": {
      "restitution": 0.18,
      "friction": 0.85,
      "give": 0.5,
      "flex": 0.5,
      "sound": "contact.branch",
      "label": "Twigs",
      "layer": "mid"
    },
    "bush_leaves": {
      "porous": {
        "drag": 15,
        "deflect": 1.2,
        "spinDrag": 5,
        "catchSpeed": 3.4,
        "hold": 0.85
      },
      "sound": "contact.bush",
      "label": "Dense leaves",
      "layer": "outer"
    },
    "plush_core": {
      "restitution": 0.12,
      "friction": 0.9,
      "give": 0.3,
      "sound": "contact.plush",
      "label": "Stuffed body",
      "layer": "core"
    },
    "plush_skin": {
      "restitution": 0.3,
      "friction": 0.6,
      "give": 0.15,
      "sound": "contact.plush",
      "label": "Plush skin",
      "layer": "mid"
    },
    "fur": {
      "porous": {
        "drag": 5,
        "deflect": 0.35,
        "spinDrag": 4,
        "catchSpeed": 1.2,
        "hold": 0.25
      },
      "sound": "contact.fur",
      "label": "Fur",
      "layer": "outer"
    },
    "lab_steel": {
      "restitution": 0.5,
      "friction": 0.25,
      "sound": "contact.metal",
      "label": "Steel",
      "layer": "core"
    },
    "concrete_block": {
      "restitution": 0.48,
      "friction": 0.5,
      "sound": "contact.hard",
      "label": "Concrete",
      "layer": "core"
    }
  }
};
});
