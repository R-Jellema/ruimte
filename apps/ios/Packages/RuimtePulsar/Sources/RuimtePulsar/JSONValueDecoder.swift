import Foundation

extension JSONValue {
    /// The value as one of the generated wire types, read straight from the tree without a round trip through bytes.
    /// A frame is validated as a whole when it arrives, so this only maps what was already checked.
    public func decoded<Value: Decodable>(as type: Value.Type = Value.self) throws -> Value {
        try JSONValueDecoding.unbox(self, as: type, path: [])
    }

    /// A generated wire value as the tree the wire carries, for what takes untyped JSON on purpose, like the
    /// interpreter of a reply's blocks.
    public init<Value: Encodable>(encoding value: Value) throws {
        self = try JSONValue.decode(JSONEncoder().encode(value))
    }
}

private enum JSONValueDecoding {
    static func unbox<Value: Decodable>(_ value: JSONValue, as type: Value.Type, path: [any CodingKey]) throws
        -> Value
    {
        if let primitive = try primitive(value, as: type, path: path) { return primitive }
        if type == JSONValue.self, let value = value as? Value { return value }
        return try Value(from: JSONValueDecoder(value: value, codingPath: path))
    }

    /// Nil when the type is not a primitive, so the caller decodes it as a container.
    private static func primitive<Value>(_ value: JSONValue, as type: Value.Type, path: [any CodingKey]) throws
        -> Value?
    {
        if type == String.self {
            guard case .string(let string) = value else { throw mismatch(type, value, path) }
            return string as? Value
        }
        if type == Bool.self {
            guard case .bool(let bool) = value else { throw mismatch(type, value, path) }
            return bool as? Value
        }
        if type == Double.self {
            guard case .number(let number) = value else { throw mismatch(type, value, path) }
            return number as? Value
        }
        if type == Float.self {
            guard case .number(let number) = value else { throw mismatch(type, value, path) }
            return Float(number) as? Value
        }
        if type == Int64.self {
            guard case .number(let number) = value, let exact = Int64(exactly: number) else {
                throw mismatch(type, value, path)
            }
            return exact as? Value
        }
        if type == Int.self {
            guard case .number(let number) = value, let exact = Int(exactly: number) else {
                throw mismatch(type, value, path)
            }
            return exact as? Value
        }
        return nil
    }

    static func mismatch(_ type: Any.Type, _ value: JSONValue, _ path: [any CodingKey]) -> DecodingError {
        .typeMismatch(type, .init(codingPath: path, debugDescription: "Found \(value) instead"))
    }
}

private struct JSONValueDecoder: Decoder {
    let value: JSONValue
    let codingPath: [any CodingKey]
    var userInfo: [CodingUserInfoKey: Any] { [:] }

    func container<Key: CodingKey>(keyedBy type: Key.Type) throws -> KeyedDecodingContainer<Key> {
        guard case .object(let object) = value else {
            throw JSONValueDecoding.mismatch([String: JSONValue].self, value, codingPath)
        }
        return KeyedDecodingContainer(KeyedContainer<Key>(object: object, codingPath: codingPath))
    }

    func unkeyedContainer() throws -> any UnkeyedDecodingContainer {
        guard case .array(let array) = value else {
            throw JSONValueDecoding.mismatch([JSONValue].self, value, codingPath)
        }
        return UnkeyedContainer(array: array, codingPath: codingPath)
    }

    func singleValueContainer() throws -> any SingleValueDecodingContainer {
        SingleValueContainer(value: value, codingPath: codingPath)
    }
}

private struct KeyedContainer<Key: CodingKey>: KeyedDecodingContainerProtocol {
    let object: [String: JSONValue]
    let codingPath: [any CodingKey]
    var allKeys: [Key] { object.keys.compactMap { Key(stringValue: $0) } }

    func contains(_ key: Key) -> Bool { object[key.stringValue] != nil }

    func decodeNil(forKey key: Key) throws -> Bool { try value(for: key) == .null }

    func decode<Value: Decodable>(_ type: Value.Type, forKey key: Key) throws -> Value { try take(type, key) }
    func decode(_ type: Bool.Type, forKey key: Key) throws -> Bool { try take(type, key) }
    func decode(_ type: String.Type, forKey key: Key) throws -> String { try take(type, key) }
    func decode(_ type: Double.Type, forKey key: Key) throws -> Double { try take(type, key) }
    func decode(_ type: Float.Type, forKey key: Key) throws -> Float { try take(type, key) }
    func decode(_ type: Int.Type, forKey key: Key) throws -> Int { try take(type, key) }
    func decode(_ type: Int64.Type, forKey key: Key) throws -> Int64 { try take(type, key) }
    func decode(_ type: Int8.Type, forKey key: Key) throws -> Int8 { try integer(type, key) }
    func decode(_ type: Int16.Type, forKey key: Key) throws -> Int16 { try integer(type, key) }
    func decode(_ type: Int32.Type, forKey key: Key) throws -> Int32 { try integer(type, key) }
    func decode(_ type: UInt.Type, forKey key: Key) throws -> UInt { try integer(type, key) }
    func decode(_ type: UInt8.Type, forKey key: Key) throws -> UInt8 { try integer(type, key) }
    func decode(_ type: UInt16.Type, forKey key: Key) throws -> UInt16 { try integer(type, key) }
    func decode(_ type: UInt32.Type, forKey key: Key) throws -> UInt32 { try integer(type, key) }
    func decode(_ type: UInt64.Type, forKey key: Key) throws -> UInt64 { try integer(type, key) }

    func nestedContainer<NestedKey: CodingKey>(keyedBy type: NestedKey.Type, forKey key: Key) throws
        -> KeyedDecodingContainer<NestedKey>
    {
        try JSONValueDecoder(value: value(for: key), codingPath: codingPath + [key]).container(keyedBy: type)
    }

    func nestedUnkeyedContainer(forKey key: Key) throws -> any UnkeyedDecodingContainer {
        try JSONValueDecoder(value: value(for: key), codingPath: codingPath + [key]).unkeyedContainer()
    }

    func superDecoder() throws -> any Decoder { JSONValueDecoder(value: .object(object), codingPath: codingPath) }

    func superDecoder(forKey key: Key) throws -> any Decoder {
        JSONValueDecoder(value: object[key.stringValue] ?? .null, codingPath: codingPath + [key])
    }

    private func value(for key: Key) throws -> JSONValue {
        guard let value = object[key.stringValue] else {
            throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "Missing"))
        }
        return value
    }

    private func take<Value: Decodable>(_ type: Value.Type, _ key: Key) throws -> Value {
        try JSONValueDecoding.unbox(value(for: key), as: type, path: codingPath + [key])
    }

    private func integer<Value: FixedWidthInteger>(_ type: Value.Type, _ key: Key) throws -> Value {
        let number = try take(Double.self, key)
        guard let exact = Value(exactly: number) else {
            throw JSONValueDecoding.mismatch(type, .number(number), codingPath + [key])
        }
        return exact
    }
}

private struct UnkeyedContainer: UnkeyedDecodingContainer {
    let array: [JSONValue]
    let codingPath: [any CodingKey]
    private(set) var currentIndex = 0
    var count: Int? { array.count }
    var isAtEnd: Bool { currentIndex >= array.count }

    init(array: [JSONValue], codingPath: [any CodingKey]) {
        self.array = array
        self.codingPath = codingPath
    }

    mutating func decodeNil() throws -> Bool {
        guard try peek() == .null else { return false }
        currentIndex += 1
        return true
    }

    mutating func decode<Value: Decodable>(_ type: Value.Type) throws -> Value { try take(type) }
    mutating func decode(_ type: Bool.Type) throws -> Bool { try take(type) }
    mutating func decode(_ type: String.Type) throws -> String { try take(type) }
    mutating func decode(_ type: Double.Type) throws -> Double { try take(type) }
    mutating func decode(_ type: Float.Type) throws -> Float { try take(type) }
    mutating func decode(_ type: Int.Type) throws -> Int { try take(type) }
    mutating func decode(_ type: Int64.Type) throws -> Int64 { try take(type) }
    mutating func decode(_ type: Int8.Type) throws -> Int8 { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: Int16.Type) throws -> Int16 { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: Int32.Type) throws -> Int32 { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: UInt.Type) throws -> UInt { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: UInt8.Type) throws -> UInt8 { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: UInt16.Type) throws -> UInt16 { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: UInt32.Type) throws -> UInt32 { try next().singleValueContainer().decode(type) }
    mutating func decode(_ type: UInt64.Type) throws -> UInt64 { try next().singleValueContainer().decode(type) }

    private mutating func take<Value: Decodable>(_ type: Value.Type) throws -> Value {
        let value = try JSONValueDecoding.unbox(peek(), as: type, path: codingPath + [IndexKey(currentIndex)])
        currentIndex += 1
        return value
    }

    mutating func nestedContainer<NestedKey: CodingKey>(keyedBy type: NestedKey.Type) throws
        -> KeyedDecodingContainer<NestedKey>
    {
        try next().container(keyedBy: type)
    }

    mutating func nestedUnkeyedContainer() throws -> any UnkeyedDecodingContainer { try next().unkeyedContainer() }

    mutating func superDecoder() throws -> any Decoder { try next() }

    private func peek() throws -> JSONValue {
        guard !isAtEnd else {
            throw DecodingError.valueNotFound(
                JSONValue.self, .init(codingPath: codingPath, debugDescription: "The array has ended"))
        }
        return array[currentIndex]
    }

    private mutating func next() throws -> JSONValueDecoder {
        let decoder = JSONValueDecoder(value: try peek(), codingPath: codingPath + [IndexKey(currentIndex)])
        currentIndex += 1
        return decoder
    }
}

private struct SingleValueContainer: SingleValueDecodingContainer {
    let value: JSONValue
    let codingPath: [any CodingKey]

    func decodeNil() -> Bool { value == .null }

    func decode<Value: Decodable>(_ type: Value.Type) throws -> Value {
        try JSONValueDecoding.unbox(value, as: type, path: codingPath)
    }

    func decode(_ type: Bool.Type) throws -> Bool { try unbox(type) }
    func decode(_ type: String.Type) throws -> String { try unbox(type) }
    func decode(_ type: Double.Type) throws -> Double { try unbox(type) }
    func decode(_ type: Float.Type) throws -> Float { try unbox(type) }
    func decode(_ type: Int.Type) throws -> Int { try unbox(type) }
    func decode(_ type: Int64.Type) throws -> Int64 { try unbox(type) }
    func decode(_ type: Int8.Type) throws -> Int8 { try integer(type) }
    func decode(_ type: Int16.Type) throws -> Int16 { try integer(type) }
    func decode(_ type: Int32.Type) throws -> Int32 { try integer(type) }
    func decode(_ type: UInt.Type) throws -> UInt { try integer(type) }
    func decode(_ type: UInt8.Type) throws -> UInt8 { try integer(type) }
    func decode(_ type: UInt16.Type) throws -> UInt16 { try integer(type) }
    func decode(_ type: UInt32.Type) throws -> UInt32 { try integer(type) }
    func decode(_ type: UInt64.Type) throws -> UInt64 { try integer(type) }

    private func unbox<Value: Decodable>(_ type: Value.Type) throws -> Value {
        try JSONValueDecoding.unbox(value, as: type, path: codingPath)
    }

    private func integer<Value: FixedWidthInteger>(_ type: Value.Type) throws -> Value {
        guard case .number(let number) = value, let exact = Value(exactly: number) else {
            throw JSONValueDecoding.mismatch(type, value, codingPath)
        }
        return exact
    }
}

private struct IndexKey: CodingKey {
    let intValue: Int?
    var stringValue: String { intValue.map(String.init) ?? "" }
    init(_ index: Int) { intValue = index }
    init?(stringValue: String) { nil }
    init?(intValue: Int) { self.intValue = intValue }
}
