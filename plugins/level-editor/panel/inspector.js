// The inspector for the selected object: name, class, position, size and
// custom properties. Each change is one step in the panel's history.
import * as tmj from "./tmj.js";
import { h, icon, iconButton } from "./dom.js";

/**
 * Makes the inspector in `element`; call the function it returns to draw it
 * again after a change. Fields keep what is being typed in them.
 */
export function createInspector({ element, t, selection: currentSelection, doc: currentDoc, editable, editFields, deleteSelection }) {
  function renderInspector() {
    const box = element;
    const selection = currentSelection();
    if (!selection) {
      if (box.dataset.object !== "") {
        box.dataset.object = "";
        box.object = undefined;
        box.fields = [];
        box.replaceChildren(h("p", { class: "note" }, t.noSelection));
      }
      return;
    }
    const { object } = selection;
    const readOnly = !editable();
    const signature = JSON.stringify([object.id, readOnly, Boolean(object.point), (object.properties ?? []).map((property) => [property.name, property.type])]);
    if (box.object === object && box.signature === signature) {
      // Same object and fields: refresh the values, except in the field being typed in.
      for (const field of box.fields) {
        if (field.element === document.activeElement || field.element.matches(":focus-within")) continue;
        const value = field.value();
        if (field.kind === "checkbox") field.element.checked = Boolean(value);
        else if (field.element.value !== String(value ?? "")) field.element.value = String(value ?? "");
      }
      return;
    }
    box.object = object;
    box.signature = signature;
    box.dataset.object = String(object.id);
    box.fields = [];
    const doc = currentDoc();
    const edit = (change) => editFields(object, change);
    const input = (label, value, commit, attributes = {}) => {
      const element = h("omg-input", {
        label,
        value: String(value() ?? ""),
        readonly: readOnly,
        ...attributes,
        on: { change: (event) => commit(event.currentTarget.value) },
      });
      box.fields.push({ element, value });
      return element;
    };
    const number = (key) =>
      input(t[key], () => object[key] ?? 0, (text) => {
        const value = Number.parseFloat(text);
        if (Number.isFinite(value)) edit((target) => tmj.setKey(target, key, value));
        else renderInspector();
      }, { type: "number", step: "any", disabled: (key === "width" || key === "height") && object.point ? true : undefined });
    const classKey = tmj.classKey(doc, object);
    const properties = (object.properties ?? []).map((property) => propertyRow(object, property, readOnly));
    box.replaceChildren(
      h("div", { class: "object-id" }, h("span", { class: "note" }, `#${object.id ?? "?"}`)),
      input(t.name, () => object.name ?? "", (value) => edit((target) => tmj.setKey(target, "name", value))),
      input(t.className, () => object[classKey] ?? "", (value) => edit((target) => tmj.setKey(target, classKey, value))),
      h("div", { class: "field-grid" }, number("x"), number("y"), number("width"), number("height")),
      h("div", { class: "subhead" }, t.properties),
      h("div", { class: "property-list" }, properties),
      readOnly
        ? undefined
        : h(
            "div",
            { class: "inspector-actions" },
            h("omg-button", { variant: "ghost", on: { click: () => addProperty(object) } }, icon("plus"), t.addProperty),
            h("omg-button", { variant: "danger", on: { click: () => deleteSelection() } }, icon("trash"), t.deleteObject),
          ),
    );
  }

  function propertyRow(object, property, readOnly) {
    const box = element;
    const edit = (change) => editFields(object, change);
    const simple = tmj.PROPERTY_TYPES.includes(property.type ?? "string");
    const type = property.type ?? "string";
    const name = h("omg-input", {
      "aria-label": t.propertyName,
      value: property.name,
      readonly: readOnly,
      on: {
        change: (event) => {
          const next = event.currentTarget.value.trim();
          if (next && next !== property.name) edit((target) => tmj.renameProperty(target, property.name, next));
          else event.currentTarget.value = property.name;
          renderInspector();
        },
      },
    });
    const typeSelect = simple
      ? h(
          "omg-select",
          {
            "aria-label": t.propertyType,
            value: type,
            disabled: readOnly,
            on: { change: (event) => edit((target) => tmj.setProperty(target, property.name, event.currentTarget.value, tmj.propertyValue(event.currentTarget.value, property.value))) },
          },
          tmj.PROPERTY_TYPES.map((option) => h("option", { value: option }, option)),
        )
      : h("span", { class: "property-type" }, type);
    let value;
    if (type === "bool") {
      value = h("omg-checkbox", {
        "aria-label": t.propertyValue,
        checked: Boolean(property.value),
        disabled: readOnly,
        on: { change: (event) => edit((target) => tmj.setProperty(target, property.name, "bool", event.currentTarget.checked)) },
      });
      box.fields.push({ element: value, kind: "checkbox", value: () => property.value });
    } else {
      value = h("omg-input", {
        "aria-label": t.propertyValue,
        value: simple ? String(property.value ?? "") : JSON.stringify(property.value),
        readonly: readOnly || !simple,
        type: type === "int" || type === "float" ? "number" : undefined,
        step: type === "float" ? "any" : undefined,
        on: { change: (event) => edit((target) => tmj.setProperty(target, property.name, type, tmj.propertyValue(type, event.currentTarget.value))) },
      });
      if (simple) box.fields.push({ element: value, value: () => property.value });
    }
    return h(
      "div",
      { class: "property-row" },
      name,
      typeSelect,
      value,
      readOnly ? undefined : iconButton("close", t.removeProperty, () => edit((target) => tmj.setProperty(target, property.name, type, undefined))),
    );
  }

  function addProperty(object) {
    const names = new Set((object.properties ?? []).map((property) => property.name));
    let name = t.newProperty;
    for (let n = 2; names.has(name); n++) name = `${t.newProperty} ${n}`;
    editFields(object, (target) => tmj.setProperty(target, name, "string", ""));
  }

  return renderInspector;
}
