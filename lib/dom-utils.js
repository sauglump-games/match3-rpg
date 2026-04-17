export class DOMManager {
    constructor() {
        this.elements = new Map();
    }

    createElement(tag, attributes = {}, content = '') {
        const element = document.createElement(tag);
        // foo
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'class') {
                element.className = value;
            } else if (key === 'data' && typeof value === 'object') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    element.dataset[dataKey] = dataValue;
                });
            } else {
                element.setAttribute(key, value);
            }
        });
        
        if (content) {
            element.textContent = content;
        }
        
        return element;
    }

    addElement(id, element, parentSelector = 'body') {
        const parent = document.querySelector(parentSelector);
        if (!parent) {
            throw new Error(`Parent element not found: ${parentSelector}`);
        }
        
        parent.appendChild(element);
        this.elements.set(id, element);
        return element;
    }

    removeElement(id) {
        const element = this.elements.get(id);
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
            this.elements.delete(id);
            return true;
        }
        return false;
    }

    updateElement(id, updates = {}) {
        const element = this.elements.get(id);
        if (!element) {
            throw new Error(`Element not found: ${id}`);
        }

        if (updates.content !== undefined) {
            element.textContent = updates.content;
        }

        if (updates.attributes) {
            Object.entries(updates.attributes).forEach(([key, value]) => {
                if (key === 'class') {
                    element.className = value;
                } else {
                    element.setAttribute(key, value);
                }
            });
        }

        if (updates.styles) {
            Object.entries(updates.styles).forEach(([property, value]) => {
                element.style[property] = value;
            });
        }

        return element;
    }

    getElement(id) {
        return this.elements.get(id);
    }

    toggleClass(id, className) {
        const element = this.elements.get(id);
        if (!element) {
            throw new Error(`Element not found: ${id}`);
        }
        
        element.classList.toggle(className);
        return element.classList.contains(className);
    }

    addEventListener(id, eventType, handler) {
        const element = this.elements.get(id);
        if (!element) {
            throw new Error(`Element not found: ${id}`);
        }
        
        element.addEventListener(eventType, handler);
    }
}

export function createList(items, listType = 'ul') {
    const list = document.createElement(listType);
    
    items.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
    });
    
    return list;
}

export function createTable(data, headers = []) {
    const table = document.createElement('table');
    
    if (headers.length > 0) {
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        headers.forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
    }
    
    const tbody = document.createElement('tbody');
    
    data.forEach(row => {
        const tr = document.createElement('tr');
        
        (Array.isArray(row) ? row : Object.values(row)).forEach(cell => {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    return table;
}