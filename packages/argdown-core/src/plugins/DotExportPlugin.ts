import { IArgdownPlugin, IRequestHandler } from "../IArgdownPlugin";
import { checkResponseFields } from "../ArgdownPluginError";
import {
  RelationType,
  ArgdownTypes,
  IMapNode,
  IGroupMapNode,
  IArgument,
  IEquivalenceClass,
  IMap,
  isGroupMapNode,
  IRange
} from "../model/model";
import { IArgdownRequest, IArgdownResponse } from "../index";
import {
  validateColorString,
  mergeDefaults,
  DefaultSettings,
  ensure,
  stringIsEmpty,
  isObject
} from "../utils";
import { addLineBreaks } from "../utils";
import defaultsDeep from "lodash.defaultsdeep";
import merge from "lodash.merge";
import { IImagesSettings } from "./MapNodeImagesPlugin";

export interface IRankMap {
  [key: string]: IRank;
}
export interface IRank {
  arguments: string[];
  statements: string[];
}
export interface IDotSettings {
  useHtmlLabels?: boolean;
  graphname?: string;
  measureLineWidth?: boolean;
  mapBgColor?: string;
  group?: {
    lineWidth?: number;
    charactersInLine?: number;
    font?: string;
    fontSize?: number;
    bold?: boolean;
    margin?: string;
  };
  closedGroup?: {
    lineWidth?: number;
    charactersInLine?: number;
    font?: string;
    fontSize?: number;
    bold?: boolean;
    margin?: string;
  };
  statement?: {
    lineWidth?: number;
    minWidth?: number;
    margin?: string;
    shape?: string;
    style?: string;
    title?: {
      font: string;
      fontSize: number;
      bold: boolean;
      charactersInLine?: number;
    };
    text?: {
      font: string;
      fontSize: number;
      bold: boolean;
      charactersInLine?: number;
    };
    images?: {
      position: "top" | "bottom";
      padding: number;
    };
  };
  argument?: {
    lineWidth?: number;
    minWidth?: number;
    margin?: string;
    shape?: string;
    style?: string;
    title?: {
      font: string;
      fontSize: number;
      bold: boolean;
      charactersInLine?: number;
    };
    text?: {
      font: string;
      fontSize: number;
      bold: boolean;
      charactersInLine?: number;
    };
    images?: {
      position: "top" | "bottom";
      padding: number;
    };
  };
  edge?: {
    arrowSize: number;
    penWidth: number;
  };
  graphVizSettings?: { [name: string]: string };
  sameRank?: IRank[];
}
declare module "../index" {
  interface IArgdownRequest {
    /**
     * Settings for the [[DotExportPlugin]]
     */
    dot?: IDotSettings;
  }
  interface IArgdownResponse {
    /**
     * Exported dot version of argument map
     *
     * Provided by the [[DotExportPlugin]]
     */
    dot?: string;
    /**
     * Temporary counter for groups used by the [[DotExportPlugin]]
     */
    groupCount?: number;
  }
}

const defaultSettings: DefaultSettings<IDotSettings> = {
  useHtmlLabels: true,
  graphname: "Argument Map",
  mapBgColor: "transparent",
  measureLineWidth: false,
  group: ensure.object({
    lineWidth: 400,
    charactersInLine: 80,
    font: "arial",
    fontSize: 12,
    bold: false,
    margin: "8"
  }),
  closedGroup: ensure.object({
    lineWidth: 400,
    charactersInLine: 80,
    font: "arial",
    fontSize: 12,
    bold: false,
    margin: "0.2"
  }),
  argument: ensure.object({
    lineWidth: 180,
    minWidth: 180,
    margin: "0.11,0.055",
    shape: "box",
    style: "filled, rounded",
    title: ensure.object({
      font: "arial",
      fontSize: 10,
      bold: true,
      charactersInLine: 40
    }),
    text: ensure.object({
      font: "arial",
      fontSize: 10,
      bold: false,
      charactersInLine: 40
    }),
    images: ensure.object({
      position: "top",
      padding: 0
    })
  }),
  statement: ensure.object({
    lineWidth: 180,
    minWidth: 180,
    margin: "0.11,0.055",
    shape: "box",
    style: "filled,rounded,bold",
    title: ensure.object({
      font: "arial",
      fontSize: 10,
      bold: true,
      charactersInLine: 40
    }),
    text: ensure.object({
      font: "arial",
      fontSize: 10,
      bold: false,
      charactersInLine: 40
    }),
    images: ensure.object({
      position: "top",
      padding: 0
    })
  }),
  edge: ensure.object({
    penWidth: 1,
    arrowSize: 1
  }),
  graphVizSettings: ensure.object({
    rankdir: "BT", //BT | TB | LR | RL
    concentrate: "false",
    ratio: "auto",
    size: "10,10"
  }),
  sameRank: ensure.array([])
};

/**
 * Exports map data to dot format.
 * The result ist stored in the [[IDotResponse.dot]] response object property.
 *
 * Depends on data from: [[MapPlugin]]
 */
export class DotExportPlugin implements IArgdownPlugin {
  name: string = "DotExportPlugin";
  defaults: IDotSettings;
  constructor(config?: IDotSettings) {
    this.defaults = defaultsDeep({}, config, defaultSettings);
  }
  getSettings(request: IArgdownRequest): IDotSettings {
    if (isObject(request.dot)) {
      const settings = request.dot;
      return settings;
    } else {
      request.dot = {};
      return request.dot;
    }
  }
  prepare: IRequestHandler = (request, response) => {
    checkResponseFields(this, response, [
      "statements",
      "arguments",
      "map",
      "relations"
    ]);
    let settings = this.getSettings(request);
    mergeDefaults(settings, defaultSettings);
  };
  run: IRequestHandler = (request, response) => {
    const settings = this.getSettings(request);
    let rankMap: IRankMap = {};
    rankMap = Object.values(response.arguments!).reduce(
      reduceToRankMap,
      rankMap
    );
    rankMap = Object.values(response.statements!).reduce(
      reduceToRankMap,
      rankMap
    );
    settings.sameRank!.push(...Object.values(rankMap));

    response.groupCount = 0;
    let dot = `digraph "${settings.graphname}" {\n\n`;
    if (settings.graphVizSettings) {
      const keys = Object.keys(settings.graphVizSettings);
      for (let key of keys) {
        const value = settings.graphVizSettings[key];
        dot += key + ' = "' + value + '";\n';
      }
    }
    dot += `edge[arrowsize="${settings.edge?.arrowSize}", penwidth="${settings.edge?.penWidth}"]`;
    dot += `graph [bgcolor = "${settings.mapBgColor}" ]`;

    for (let node of response.map!.nodes) {
      dot += this.exportNodesRecursive(node, request, response, settings);
    }

    dot += "\n\n";
    const edges = response.map!.edges;
    for (let edge of edges) {
      let attributes = `type="${edge.relationType}", `;
      attributes += `color="${edge.color}"`;
      switch (edge.relationType) {
        case RelationType.CONTRARY:
          attributes += `, dir="both"`;
          break;
        case RelationType.CONTRADICTORY:
          attributes += `, dir="both", arrowtail="diamond", arrowhead="diamond"`;
          break;
      }
      dot += `  ${edge.from.id} -> ${edge.to.id} [${attributes}];\n`;
    }
    if (settings.sameRank && settings.sameRank.length > 0) {
      const nodeMaps = getNodeIdsMaps(response.map!);
      for (let rank of settings.sameRank) {
        dot += `{ rank = same;\n`;
        for (let argumentTitle of rank.arguments) {
          const id = nodeMaps.argumentNodes[argumentTitle];
          if (!id) {
            continue;
          }
          dot += `${id};\n`;
        }
        for (let ecTitle of rank.statements) {
          const id = nodeMaps.statementNodes[ecTitle];
          if (!id) {
            continue;
          }
          dot += `${id};\n`;
        }
        dot += `};\n`;
      }
    }

    dot += "\n}";

    response.dot = dot;
    return response;
  };
  exportNodesRecursive(
    node: IMapNode,
    request: IArgdownRequest,
    response: IArgdownResponse,
    settings: IDotSettings
  ): string {
    let dot = "";
    response.groupCount =
      response.groupCount === undefined ? 0 : response.groupCount;
    if (node.type === ArgdownTypes.GROUP_MAP_NODE) {
      const groupNode: IGroupMapNode = <IGroupMapNode>node;
      response.groupCount++;
      let dotGroupId = "cluster_" + response.groupCount;
      let groupLabel = node.labelTitle || "";
      const groupSettings = groupNode.isClosed
        ? settings.closedGroup
        : settings.group;
      if (settings.useHtmlLabels) {
        groupLabel = settings.measureLineWidth
          ? addLineBreaksAndEscape(groupLabel, true, {
              maxWidth: groupSettings!.lineWidth!,
              fontSize: groupSettings!.fontSize!,
              bold: groupSettings!.bold!,
              font: groupSettings!.font!
            })
          : addLineBreaksAndEscape(groupLabel, false, {
              charactersInLine: groupSettings!.charactersInLine!
            });
        groupLabel = `<<FONT FACE="${groupSettings!
          .font!}" POINT-SIZE="${groupSettings!.fontSize!}" COLOR="${
          node.fontColor
        }">${groupLabel}</FONT>>`;
      } else {
        groupLabel = `"${escapeQuotesForDot(groupLabel)}"`;
      }
      let groupColor = node.color || "#CCCCCC";
      if (groupNode.isClosed) {
        dot += `  ${node.id} [label=${groupLabel}, shape="box", margin="${
          groupSettings!.margin
        }", style="filled", penwidth="0" fillcolor="${groupColor}", fontcolor="${
          node.fontColor
        }",  type="${node.type}"];\n`;
      } else {
        dot += `\nsubgraph ${dotGroupId} {\n  label = ${groupLabel};\n  color = "${groupColor}";\n  margin="${
          groupSettings!.margin
        }" style = filled;\n`;
        let labelloc = "t";
        if (
          settings.graphVizSettings &&
          settings.graphVizSettings.rankdir == "BT"
        ) {
          labelloc = "b";
        }
        dot += ` labelloc = "${labelloc}";\n\n`;
        if (groupNode.children) {
          for (let child of groupNode.children) {
            dot += this.exportNodesRecursive(
              child,
              request,
              response,
              settings
            );
          }
        }
        dot += `\n}\n\n`;
      }
      return dot;
    }

    let label = "";
    let color =
      node.color && validateColorString(node.color) ? node.color : "#63AEF2";
    const imageSettings = request.images || {};
    imageSettings.files = imageSettings.files || {};
    label = getLabel(node, settings, imageSettings);
    if (node.type === ArgdownTypes.ARGUMENT_MAP_NODE) {
      const shape = settings.argument!.shape;
      const widthProp =
        label == `""` ? `, width="${settings.argument!.minWidth}"` : "";
      dot += `  ${node.id} [label=${label}, margin="${
        settings.argument!.margin
      }", shape="${shape}", style="${
        settings.argument!.style
      }", fillcolor="${color}", fontcolor="${node.fontColor}",  type="${
        node.type
      }"${widthProp}];\n`;
    } else if (node.type === ArgdownTypes.STATEMENT_MAP_NODE) {
      const shape = settings.statement!.shape;
      const widthProp =
        label == `""` ? `, width="${settings.statement!.minWidth}"` : "";

      dot += `  ${node.id} [label=${label}, shape="${shape}",  margin="${
        settings.statement!.margin
      }", style="${
        settings.statement!.style
      }", color="${color}", fillcolor="${color}", labelfontcolor="white", fontcolor="${
        node.fontColor
      }", type="${node.type}"${widthProp}];\n`;
    }
    return dot;
  }
}

const addLineBreaksAndEscape = (
  str: string,
  measurePixelWidth: boolean,
  options: {
    maxWidth?: number;
    charactersInLine?: number;
    fontSize?: number;
    font?: string;
    bold?: boolean;
    applyRanges?: IRange[];
  }
): string => {
  const result = addLineBreaks(
    str,
    measurePixelWidth,
    merge(
      {
        lineBreak: "<BR/>",
        escapeAsHtmlEntities: true
      },
      options
    )
  );
  return result.text;
};
const escapeQuotesForDot = (str: string): string => {
  return str.replace(/\"/g, '\\"');
};
const getLabel = (
  node: IMapNode,
  settings: IDotSettings,
  imageSettings: IImagesSettings
): string => {
  const isArgumentNode = node.type === ArgdownTypes.ARGUMENT_MAP_NODE;
  const title = node.labelTitle;
  const text = node.labelText;
  const color = node.fontColor;
  let label = "";
  if (stringIsEmpty(title) && stringIsEmpty(text)) {
    return `""`;
  }
  if (settings.useHtmlLabels) {
    const maxLineWidth = isArgumentNode
      ? settings.argument!.lineWidth!
      : settings.statement!.lineWidth!;
    const minNodeWidth = isArgumentNode
      ? settings.argument!.minWidth!
      : settings.statement!.minWidth!;
    const imagesPosition = isArgumentNode
      ? settings.argument?.images?.position
      : settings.statement?.images?.position;
    const imagesPadding = isArgumentNode
      ? settings.argument?.images?.padding
      : settings.statement?.images?.padding;
    label += `<<TABLE WIDTH="${minNodeWidth}" ALIGN="CENTER" BORDER="0" CELLSPACING="0">`;
    let img = "";
    if (node.images) {
      if (node.images.length == 1) {
        img = `<TR><TD ALIGN="CENTER"><IMG SCALE="true" ALIGN="CENTER" SRC="${
          imageSettings.files![node.images[0]].path
        }"/></TD></TR>`;
      } else if (node.images.length > 1) {
        img = `<TR><TD><TABLE ALIGN="CENTER" BORDER="0" CELLSPACING="${imagesPadding}"><TR>${node.images
          ?.map(
            image => `<TD><IMG SRC="${imageSettings.files![image].path}"/></TD>`
          )
          .join("")}</TR></TABLE></TD></TR>`;
      }
    }
    if (imagesPosition == "top") {
      label += img;
    }
    if (!stringIsEmpty(title)) {
      let { fontSize, font, bold, charactersInLine } = isArgumentNode
        ? settings.argument!.title!
        : settings.statement!.title!;
      let titleLabel = settings.measureLineWidth
        ? addLineBreaksAndEscape(title!, true, {
            maxWidth: maxLineWidth,
            fontSize,
            bold,
            font,
            applyRanges: node.labelTitleRanges
          })
        : addLineBreaksAndEscape(title!, false, {
            charactersInLine,
            applyRanges: node.labelTitleRanges
          });
      if (bold) {
        titleLabel = `<B>${titleLabel}</B>`;
      }
      titleLabel = `<TR><TD WIDTH="${minNodeWidth}" ALIGN="TEXT" BALIGN="CENTER"><FONT FACE="${font}" POINT-SIZE="${fontSize}" COLOR="${color}">${titleLabel}</FONT></TD></TR>`;
      label += titleLabel;
    }
    if (!stringIsEmpty(text)) {
      let { fontSize, font, bold, charactersInLine } = isArgumentNode
        ? settings.argument!.text!
        : settings.statement!.text!;
      let textLabel = settings.measureLineWidth
        ? addLineBreaksAndEscape(text!, true, {
            maxWidth: maxLineWidth,
            fontSize,
            bold,
            font,
            applyRanges: node.labelTextRanges
          })
        : addLineBreaksAndEscape(text!, false, {
            charactersInLine,
            applyRanges: node.labelTextRanges
          });
      if (bold) {
        textLabel = `<B>${textLabel}</B>`;
      }
      textLabel = `<TR><TD ALIGN="TEXT" WIDTH="${minNodeWidth}" BALIGN="CENTER"><FONT FACE="${font}" POINT-SIZE="${fontSize}" COLOR="${color}">${textLabel}</FONT></TD></TR>`;
      label += textLabel;
    }
    if (imagesPosition == "bottom") {
      label += img;
    }

    label += "</TABLE>>";
  } else {
    label = '"' + escapeQuotesForDot(title || "Untitled") + '"';
  }
  return label;
};
const reduceToRankMap = (
  acc: IRankMap,
  curr: IArgument | IEquivalenceClass
) => {
  if (curr.data && curr.data.rank) {
    const rank = acc[curr.data.rank] || {
      arguments: [],
      statements: []
    };
    if (curr.type === ArgdownTypes.ARGUMENT) {
      rank.arguments.push(curr.title!);
    } else {
      rank.statements.push(curr.title!);
    }
    acc[curr.data.rank] = rank;
  }
  return acc;
};
interface INodeMaps {
  argumentNodes: { [key: string]: string };
  statementNodes: { [key: string]: string };
}
const getNodeIdsMaps = (map: IMap): INodeMaps => {
  const maps = { argumentNodes: {}, statementNodes: {} };
  map.nodes.reduce(reduceToNodeMaps, maps);
  return maps;
};
const reduceToNodeMaps = (acc: INodeMaps, curr: IMapNode) => {
  if (isGroupMapNode(curr) && curr.children) {
    acc = curr.children.reduce(reduceToNodeMaps, acc);
  } else if (curr.type === ArgdownTypes.ARGUMENT_MAP_NODE) {
    acc.argumentNodes[curr.title!] = curr.id!;
  } else if (curr.type === ArgdownTypes.STATEMENT_MAP_NODE) {
    acc.statementNodes[curr.title!] = curr.id!;
  }
  return acc;
};
