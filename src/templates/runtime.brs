' Auto-generated BrightScript runtime helpers for protoc-gen-brs
function __pb_createByteArray() as Object
    ba = CreateObject("roByteArray")
    if ba <> invalid then return ba
    return CreateObject("roArray", 0, true)
end function

function __pb_truncate(value as Double) as Double
    if value = invalid then return 0
    remainder = value MOD 1
    return value - remainder
end function

function __pb_fixNumber(value as Dynamic) as Dynamic
    if value = invalid then return invalid
    return Int(value)
end function

function __pb_normalizeMessageKeys(message as Dynamic, mapping as Object) as Dynamic
    if message = invalid then return message
    if mapping = invalid then return message
    if GetInterface(message, "ifAssociativeArray") = invalid then return message
    if GetInterface(mapping, "ifAssociativeArray") = invalid then return message
    keys = mapping.Keys()
    for each snakeKey in keys
        camelKey = mapping.Lookup(snakeKey)
        if camelKey <> invalid then
            if message.DoesExist(snakeKey) then
                ' already present
            else if message.DoesExist(camelKey) then
                value = message.Lookup(camelKey)
                message.AddReplace(snakeKey, value)
            end if
        end if
    end for
    return message
end function

function __pb_writeVarint(target as Object, value as Dynamic) as Void
    if target = invalid then return
    if value = invalid then return
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then
        trimmed = value.Trim()
        if trimmed = "" then return
        first = Left(trimmed, 1)
        if first = "-" then
            magnitude = Mid(trimmed, 2)
            magnitude = magnitude.Trim()
            if magnitude = "" then return
            unsignedStr = __pb_trimLeadingZeros(magnitude)
            if unsignedStr = "0" then
                __pb_writeVarint64(target, "0")
            else
                complement = __pb_decimalSubtract("18446744073709551616", unsignedStr)
                __pb_writeVarint64(target, complement)
            end if
            return
        else if first = "+" then
            trimmed = Mid(trimmed, 2)
        end if
        trimmed = __pb_trimLeadingZeros(trimmed)
        __pb_writeVarint64(target, trimmed)
        return
    end if
    v = __pb_truncate(value)
    if v < 0 then
        magnitude = __pb_doubleToDecimalString(0 - v)
        unsignedStr = __pb_decimalSubtract("18446744073709551616", magnitude)
        __pb_writeVarint64(target, unsignedStr)
        return
    end if
    decimalValue = __pb_doubleToDecimalString(v)
    __pb_writeVarint64(target, decimalValue)
end function

function __pb_trimLeadingZeros(value as String) as String
    if value = invalid then return "0"
    valueType = Type(value)
    if valueType <> "String" and valueType <> "roString" then
        value = value + ""
    end if
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(value)
    count = digits.Count()
    if count = 0 then return "0"
    zero = 48
    index = 0
    while index < count and digits[index] = zero
        index = index + 1
    end while
    if index >= count then return "0"
    if index = 0 then return value
    trimmed = CreateObject("roByteArray")
    for i = index to count - 1
        trimmed.Push(digits[i])
    end for
    return trimmed.ToAsciiString()
end function

function __pb_allDigits(value as String) as Boolean
    if value = invalid then return false
    valueType = Type(value)
    if valueType <> "String" and valueType <> "roString" then
        value = value + ""
    end if
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(value)
    count = digits.Count()
    if count = 0 then return false
    zero = 48
    nine = 57
    for i = 0 to count - 1
        code = digits[i]
        if code < zero or code > nine then return false
    end for
    return true
end function

function __pb_doubleToDecimalString(num as Double) as String
    if num = 0 then return "0"
    strValue = FormatJson(num)
    strType = Type(strValue)
    if strType = "String" or strType = "roString" then
        cleaned = strValue.Trim()
        cleaned = cleaned.Replace(Chr(13), "")
        cleaned = cleaned.Replace(Chr(10), "")
        if cleaned <> "" then
            first = Left(cleaned, 1)
            if first = "+"
                cleaned = Mid(cleaned, 2)
            else if first = "-"
                cleaned = Mid(cleaned, 2)
                ' negative numbers handled by caller
            end if
            if InStr(1, LCase(cleaned), "e") = 0 and InStr(1, cleaned, ".") = 0 and __pb_allDigits(cleaned) then
                return __pb_trimLeadingZeros(cleaned)
            end if
        end if
    end if
    current = __pb_truncate(num)
    digits = ""
    while current > 0
        remainder = current MOD 10
        digits = Chr(remainder + 48) + digits
        current = __pb_truncate(current / 10)
    end while
    if digits = "" then digits = "0"
    return __pb_trimLeadingZeros(digits)
end function

function __pb_normalizeUnsignedDecimal(value as Dynamic) as Dynamic
    if value = invalid then return invalid
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then
        str = value.Trim()
        if str = "" then return invalid
        first = Left(str, 1)
        if first = "+"
            str = Mid(str, 2)
        else if first = "-"
            return invalid
        end if
        if not __pb_allDigits(str) then return invalid
        return __pb_trimLeadingZeros(str)
    else if valueType = "Boolean" or valueType = "roBoolean" then
        if value = true then return "1" else return "0"
    end if
    num = __pb_toLong(value)
    if num < 0 then return invalid
    return __pb_doubleToDecimalString(num)
end function

function __pb_normalizeToUnsignedBits(value as Dynamic, maxValue as String) as String
    if value = invalid then return "0"
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then
        str = value.Trim()
        if str = "" then return "0"
        sign = Left(str, 1)
        if sign = "-" then
            magnitude = Mid(str, 2)
            magnitude = magnitude.Trim()
            if magnitude = "" then return "0"
            trimmed = __pb_trimLeadingZeros(magnitude)
            if trimmed = "0" then return "0"
            difference = __pb_decimalSubtract(maxValue, trimmed)
            return __pb_trimLeadingZeros(difference)
        else if sign = "+" then
            str = Mid(str, 2)
        end if
        return __pb_trimLeadingZeros(str)
    else if valueType = "Boolean" or valueType = "roBoolean" then
        if value = true then return "1" else return "0"
    end if
    num = __pb_toLong(value)
    if num < 0 then
        magnitude = __pb_doubleToDecimalString(0 - num)
        normalized = __pb_decimalSubtract(maxValue, magnitude)
        return __pb_trimLeadingZeros(normalized)
    end if
    return __pb_trimLeadingZeros(__pb_doubleToDecimalString(num))
end function

function __pb_normalizeUnsigned32(value as Dynamic) as String
    return __pb_normalizeToUnsignedBits(value, "4294967296")
end function

function __pb_normalizeSigned32(value as Dynamic) as String
    unsigned = __pb_normalizeToUnsignedBits(value, "4294967296")
    if __pb_decimalCompare(unsigned, "2147483647") <= 0 then
        return unsigned
    end if
    magnitude = __pb_decimalSubtract("4294967296", unsigned)
    trimmed = __pb_trimLeadingZeros(magnitude)
    if trimmed = "0" then return "0"
    return "-" + trimmed
end function

function __pb_decimalDivMod(value as String, divisor as Integer) as Object
    valueType = Type(value)
    if valueType <> "String" and valueType <> "roString" then
        value = value + ""
    end if
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(value)
    remainder = 0
    quotient = CreateObject("roByteArray")
    count = digits.Count()
    zero = 48
    for i = 0 to count - 1
        digit = digits[i] - zero
        remainder = remainder * 10 + digit
        qdigit = 0
        while remainder >= divisor
            remainder = remainder - divisor
            qdigit = qdigit + 1
        end while
        if quotient.Count() > 0 or qdigit <> 0 then
            quotient.Push(qdigit + zero)
        end if
    end for
    if quotient.Count() = 0 then
        quotient.Push(zero)
    end if
    result = {}
    result.quotient = quotient.ToAsciiString()
    result.remainder = remainder
    return result
end function

function __pb_buildVarintFromDecimal(value as String) as Object
    bytes = []
    if value = "0" then
        bytes.Push(0)
        return bytes
    end if
    current = value
    while current <> "0"
        parts = __pb_decimalDivMod(current, 128)
        bytes.Push(__pb_truncate(parts.remainder))
        current = parts.quotient
    end while
    count = bytes.Count()
    for i = 0 to count - 2
        bytes[i] = (bytes[i] OR &h80) AND &hFF
    end for
    return bytes
end function

function __pb_writeFixedFromDecimal(target as Object, decimalValue as String, byteCount as Integer) as Void
    if target = invalid then return
    current = __pb_trimLeadingZeros(decimalValue)
    for i = 0 to byteCount - 1
        parts = __pb_decimalDivMod(current, 256)
        remainder = __pb_truncate(parts.remainder)
        target.Push(Int(remainder))
        current = __pb_trimLeadingZeros(parts.quotient)
    end for
end function

function __pb_writeFixed32(target as Object, value as Dynamic) as Void
    normalized = __pb_normalizeToUnsignedBits(value, "4294967296")
    __pb_writeFixedFromDecimal(target, normalized, 4)
end function

function __pb_writeFixed64(target as Object, value as Dynamic) as Void
    normalized = __pb_normalizeToUnsignedBits(value, "18446744073709551616")
    __pb_writeFixedFromDecimal(target, normalized, 8)
end function

function __pb_writeVarint64(target as Object, value as Dynamic) as Void
    if target = invalid then return
    normalized = __pb_normalizeUnsignedDecimal(value)
    if normalized = invalid then
        valueType = Type(value)
        if valueType = "String" or valueType = "roString" then
            str = value.Trim()
            if str = "" then return
            negative = false
            first = Left(str, 1)
            if first = "-"
                negative = true
                str = Mid(str, 2)
            else if first = "+"
                str = Mid(str, 2)
            end if
            str = str.Trim()
            if str = "" then return
            if not __pb_allDigits(str) then return
            trimmed = __pb_trimLeadingZeros(str)
            if trimmed = "0" then
                normalized = "0"
            else if negative then
                normalized = __pb_decimalSubtract("18446744073709551616", trimmed)
            else
                normalized = trimmed
            end if
        else
            num = __pb_toLong(value)
            if num < 0 then
                magnitude = __pb_doubleToDecimalString(0 - num)
                normalized = __pb_decimalSubtract("18446744073709551616", magnitude)
            else
                normalized = __pb_doubleToDecimalString(num)
            end if
        end if
    end if
    bytes = __pb_buildVarintFromDecimal(normalized)
    for i = 0 to bytes.Count() - 1
        target.Push(bytes[i])
    end for
end function

function __pb_encodeZigZag32(value as Dynamic) as String
    normalized = __pb_normalizeSigned32(value)
    return __pb_encodeZigZag32FromString(normalized)
end function

function __pb_encodeZigZag32FromString(value as String) as String
    if value = invalid then return "0"
    trimmed = value
    valueType = Type(trimmed)
    if valueType <> "String" and valueType <> "roString" then
        trimmed = trimmed + ""
    end if
    trimmed = trimmed.Trim()
    if trimmed = "" then return "0"
    sign = Left(trimmed, 1)
    if sign = "+" then
        trimmed = Mid(trimmed, 2)
        trimmed = trimmed.Trim()
    end if
    if trimmed = "" then return "0"
    if sign = "-" then
        magnitude = __pb_trimLeadingZeros(Mid(trimmed, 2))
        if magnitude = "" then return "0"
        doubled = __pb_decimalMultiplyBySmall(magnitude, 2)
        return __pb_trimLeadingZeros(__pb_decimalSubtract(doubled, "1"))
    end if
    magnitude = __pb_trimLeadingZeros(trimmed)
    return __pb_trimLeadingZeros(__pb_decimalMultiplyBySmall(magnitude, 2))
end function

function __pb_decodeZigZag32(value as String) as Double
    if value = invalid then return 0
    unsignedStr = __pb_trimLeadingZeros(value)
    parts = __pb_decimalDivMod(unsignedStr, 2)
    quotient = __pb_trimLeadingZeros(parts.quotient)
    if parts.remainder = 0 then
        return __pb_parseDecimalToDouble(quotient)
    end if
    negMag = __pb_decimalAdd(quotient, "1")
    return 0 - __pb_parseDecimalToDouble(negMag)
end function

function __pb_toUnsigned32(value as Dynamic) as Double
    if value = invalid then return 0
    result = value + 0#
    if result < 0 then
        result = result + 4294967296#
    end if
    return result
end function

function __pb_toSigned32(value as Dynamic) as Double
    if value = invalid then return 0
    result = __pb_toUnsigned32(value)
    if result >= 2147483648# then
        result = result - 4294967296#
    end if
    return result
end function

function __pb_toSigned32FromString(value as String) as Double
    trimmed = __pb_trimLeadingZeros(value)
    if trimmed = "0" then return 0
    if __pb_decimalCompare(trimmed, "4294967295") > 0 then
        if __pb_decimalCompare(trimmed, "18446744069414584320") >= 0 then
            trimmed = __pb_decimalSubtract(trimmed, "18446744069414584320")
        else
            trimmed = __pb_decimalSubtract(trimmed, "4294967296")
        end if
        trimmed = __pb_trimLeadingZeros(trimmed)
    end if
    if __pb_decimalCompare(trimmed, "2147483647") <= 0 then
        return __pb_parseDecimalToDouble(trimmed)
    end if
    magnitude = __pb_decimalSubtract("4294967296", trimmed)
    return 0 - __pb_parseDecimalToDouble(magnitude)
end function

function __pb_parseDecimalToDouble(value as String) as Double
    if value = invalid then return 0#
    str = value.Trim()
    if str = "" then return 0#
    sign = 1#
    if Left(str, 1) = "-" then
        sign = -1#
        str = Mid(str, 2)
    else if Left(str, 1) = "+" then
        str = Mid(str, 2)
    end if
    digitsStr = __pb_trimLeadingZeros(str)
    if digitsStr = "0" then return 0#
    result = 0#
    length = Len(digitsStr)
    for i = 0 to length - 1
        digitChar = Mid(digitsStr, i + 1, 1)
        digitVal = Asc(digitChar) - Asc("0")
        result = (result * 10#) + (digitVal + 0#)
    end for
    return sign * result
end function

function __pb_encodeZigZag64(value as Dynamic) as String
    valueType = Type(value)
    valueStr = "0"
    if valueType = "String" or valueType = "roString" then
        valueStr = value.Trim()
        if valueStr = "" then valueStr = "0"
    else
        valueStr = __pb_toDecimalString(value)
    end if
    if Left(valueStr, 1) = "+" then
        valueStr = Mid(valueStr, 2)
    end if
    if Left(valueStr, 1) = "-" then
        magnitude = Mid(valueStr, 2)
        magnitude = __pb_trimLeadingZeros(magnitude)
        twice = __pb_decimalMultiplyBySmall(magnitude, 2)
        encoded = __pb_decimalSubtract(twice, "1")
    else
        magnitude = __pb_trimLeadingZeros(valueStr)
        encoded = __pb_decimalMultiplyBySmall(magnitude, 2)
    end if
    return __pb_trimLeadingZeros(encoded)
end function

function __pb_decodeZigZag64(value as String) as String
    trimmed = __pb_trimLeadingZeros(value)
    if trimmed = "0" then return "0"
    parts = __pb_decimalDivMod(trimmed, 2)
    if parts.remainder = 0 then
        return __pb_trimLeadingZeros(parts.quotient)
    end if
    incremented = __pb_decimalAdd(trimmed, "1")
    halfParts = __pb_decimalDivMod(incremented, 2)
    return "-" + __pb_trimLeadingZeros(halfParts.quotient)
end function

function __pb_decimalAdd(a as String, b as String) as String
    aTrim = __pb_trimLeadingZeros(a)
    bTrim = __pb_trimLeadingZeros(b)
    aBytes = CreateObject("roByteArray")
    aBytes.FromAsciiString(aTrim)
    bBytes = CreateObject("roByteArray")
    bBytes.FromAsciiString(bTrim)
    zero = 48
    carry = 0
    digits = []
    i = aBytes.Count() - 1
    j = bBytes.Count() - 1
    while i >= 0 or j >= 0 or carry > 0
        digitA = 0
        if i >= 0 then
            digitA = aBytes[i] - zero
            i = i - 1
        end if
        digitB = 0
        if j >= 0 then
            digitB = bBytes[j] - zero
            j = j - 1
        end if
        total = digitA + digitB + carry
        digits.Push((total MOD 10) + zero)
        carry = Int(total / 10)
    end while
    resultBytes = CreateObject("roByteArray")
    for k = digits.Count() - 1 to 0 step -1
        resultBytes.Push(digits[k])
    end for
    return resultBytes.ToAsciiString()
end function

function __pb_decimalCompare(a as String, b as String) as Integer
    aTrim = __pb_trimLeadingZeros(a)
    bTrim = __pb_trimLeadingZeros(b)
    aBytes = CreateObject("roByteArray")
    aBytes.FromAsciiString(aTrim)
    bBytes = CreateObject("roByteArray")
    bBytes.FromAsciiString(bTrim)
    lenA = aBytes.Count()
    lenB = bBytes.Count()
    if lenA > lenB then return 1
    if lenA < lenB then return -1
    for i = 0 to lenA - 1
        digitA = aBytes[i]
        digitB = bBytes[i]
        if digitA > digitB then return 1
        if digitA < digitB then return -1
    end for
    return 0
end function

function __pb_decimalSubtract(a as String, b as String) as String
    if __pb_decimalCompare(a, b) < 0 then return "0"
    aTrim = __pb_trimLeadingZeros(a)
    bTrim = __pb_trimLeadingZeros(b)
    aBytes = CreateObject("roByteArray")
    aBytes.FromAsciiString(aTrim)
    bBytes = CreateObject("roByteArray")
    bBytes.FromAsciiString(bTrim)
    zero = 48
    borrow = 0
    digits = []
    i = aBytes.Count() - 1
    j = bBytes.Count() - 1
    while i >= 0
        digitA = aBytes[i] - zero - borrow
        borrow = 0
        digitB = 0
        if j >= 0 then
            digitB = bBytes[j] - zero
            j = j - 1
        end if
        digitA = digitA - digitB
        if digitA < 0 then
            digitA = digitA + 10
            borrow = 1
        end if
        digits.Push(digitA + zero)
        i = i - 1
    end while
    while digits.Count() > 1 and digits[digits.Count() - 1] = zero
        digits.Pop()
    end while
    resultBytes = CreateObject("roByteArray")
    for k = digits.Count() - 1 to 0 step -1
        resultBytes.Push(digits[k])
    end for
    return resultBytes.ToAsciiString()
end function

function __pb_decimalMultiplyBySmall(value as String, factor as Integer) as String
    base = __pb_trimLeadingZeros(value)
    if factor = 0 or base = "0" then return "0"
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(base)
    carry = 0
    zero = 48
    resultDigits = []
    for i = digits.Count() - 1 to 0 step -1
        digit = digits[i] - zero
        total = digit * factor + carry
        resultDigits.Push((total MOD 10) + zero)
        carry = Int(total / 10)
    end for
    while carry > 0
        resultDigits.Push((carry MOD 10) + zero)
        carry = Int(carry / 10)
    end while
    resultBytes = CreateObject("roByteArray")
    for k = resultDigits.Count() - 1 to 0 step -1
        resultBytes.Push(resultDigits[k])
    end for
    return resultBytes.ToAsciiString()
end function

function __pb_decimalMultiplyBy128(value as String) as String
    result = __pb_trimLeadingZeros(value)
    if result = "0" then return "0"
    for i = 1 to 7
        result = __pb_decimalMultiplyBySmall(result, 2)
    end for
    return __pb_trimLeadingZeros(result)
end function

function __pb_decimalMultiplyByPowerOfTwo(value as String, power as Integer) as String
    result = __pb_trimLeadingZeros(value)
    if result = "0" then return "0"
    for i = 1 to power
        result = __pb_decimalMultiplyBySmall(result, 2)
    end for
    return __pb_trimLeadingZeros(result)
end function

function __pb_uint64PartsToDecimalString(high as Double, low as Double) as String
    highComponent = __pb_doubleToDecimalString(high)
    highShifted = __pb_decimalMultiplyByPowerOfTwo(highComponent, 32)
    lowComponent = __pb_trimLeadingZeros(__pb_doubleToDecimalString(low))
    return __pb_trimLeadingZeros(__pb_decimalAdd(highShifted, lowComponent))
end function

function __pb_toSignedInt64String(unsigned as String) as String
    if unsigned = invalid then return "0"
    trimmed = __pb_trimLeadingZeros(unsigned)
    if trimmed = "0" then return "0"
    threshold = "9223372036854775807"
    comparison = __pb_decimalCompare(trimmed, threshold)
    if comparison <= 0 then return trimmed
    diff = __pb_decimalSubtract("18446744073709551616", trimmed)
    if diff = "0" then return "0"
    return "-" + diff
end function

function __pb_decodeVarintToDecimalString(bytes as Object) as String
    result = "0"
    multiplier = "1"
    count = bytes.Count()
    for i = 0 to count - 1
        byteVal = bytes[i]
        chunk = byteVal AND &h7F
        if chunk > 0 then
            term = __pb_decimalMultiplyBySmall(multiplier, chunk)
            result = __pb_decimalAdd(result, term)
        end if
        if (byteVal AND &h80) = 0 then exit for
        multiplier = __pb_decimalMultiplyBy128(multiplier)
    end for
    return __pb_trimLeadingZeros(result)
end function

function __pb_appendByteArray(target as Object, source as Object) as Void
    for i = 0 to source.Count() - 1
        target.Push(source[i])
    end for
end function

function __pb_toBase64(bytes as Object) as String
    if bytes = invalid then return ""
    compType = Type(bytes)
    if compType = "roByteArray" or compType = "ifByteArray" then
        return bytes.ToBase64String()
    end if

    base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    encoded = ""
    count = bytes.Count()
    index = 0
    while index < count
        byte1 = bytes[index] AND &hFF
        index = index + 1

        hasByte2 = index < count
        byte2 = 0
        if hasByte2 then
            byte2 = bytes[index] AND &hFF
            index = index + 1
        end if

        hasByte3 = index < count
        byte3 = 0
        if hasByte3 then
            byte3 = bytes[index] AND &hFF
            index = index + 1
        end if

        triple = (byte1 * 65536) + (byte2 * 256) + byte3
        first = __pb_fixNumber(triple / 262144)
        second = __pb_fixNumber((triple / 4096) MOD 64)
        third = __pb_fixNumber((triple / 64) MOD 64)
        fourth = __pb_fixNumber(triple MOD 64)

        encoded = encoded + Mid(base64Chars, first + 1, 1)
        encoded = encoded + Mid(base64Chars, second + 1, 1)

        if hasByte2 then
            encoded = encoded + Mid(base64Chars, third + 1, 1)
        else
            encoded = encoded + "="
        end if

        if hasByte3 then
            encoded = encoded + Mid(base64Chars, fourth + 1, 1)
        else
            encoded = encoded + "="
        end if
    end while
    return encoded
end function

function __pb_fromBase64(encoded as String) as Object
    ba = CreateObject("roByteArray")
    ba.FromBase64String(encoded)
    return ba
end function

function __pb_readVarint(bytes as Object, startIndex as Integer) as Object
    wideResult = __pb_readVarint64(bytes, startIndex)
    if wideResult = invalid then
        safeResult = {}
        safeResult.value = 0
        safeResult.nextIndex = startIndex
        return safeResult
    end if
    wideResult.value = __pb_parseDecimalToDouble(wideResult.value)
    return wideResult
end function

function __pb_readVarint64(bytes as Object, startIndex as Integer) as Object
    result = {}
    chunk = []
    index = startIndex
    count = bytes.Count()
    while index < count
        byte = bytes[index]
        chunk.Push(byte)
        index = index + 1
        if (byte AND &h80) = 0 then exit while
    end while
    result.value = __pb_decodeVarintToDecimalString(chunk)
    result.nextIndex = index
    return result
end function

function __pb_readFixed32(bytes as Object, startIndex as Integer) as Object
    result = {}
    value = 0#
    multiplier = 1#
    for i = 0 to 3
        byteVal = bytes[startIndex + i] AND &hFF
        value = value + (byteVal * multiplier)
        multiplier = multiplier * 256#
    end for
    result.value = value
    result.nextIndex = startIndex + 4
    return result
end function

function __pb_readFixed64Raw(bytes as Object, startIndex as Integer) as Object
    result = {}
    low = 0#
    multiplier = 1#
    for i = 0 to 3
        byteVal = bytes[startIndex + i] AND &hFF
        low = low + (byteVal * multiplier)
        multiplier = multiplier * 256#
    end for
    high = 0#
    multiplier = 1#
    for i = 0 to 3
        byteVal = bytes[startIndex + 4 + i] AND &hFF
        high = high + (byteVal * multiplier)
        multiplier = multiplier * 256#
    end for
    result.low = low
    result.high = high
    result.nextIndex = startIndex + 8
    return result
end function

function __pb_readFixed64(bytes as Object, startIndex as Integer) as Object
    raw = __pb_readFixed64Raw(bytes, startIndex)
    result = {}
    result.low = raw.low
    result.high = raw.high
    result.value = __pb_uint64PartsToDecimalString(raw.high, raw.low)
    result.nextIndex = raw.nextIndex
    return result
end function

function __pb_doubleToUint64Parts(value as Double) as Object
    parts = {}
    parts.high = 0#
    parts.low = 0#
    if value = invalid then return parts
    if value = 0 then
        if value < 0 then
            parts.high = 2147483648#
        end if
        return parts
    end if
    signBit = 0#
    if value < 0 then
        signBit = 1#
        value = 0 - value
    end if
    if value = 0 then
        parts.high = signBit * 2147483648#
        return parts
    end if
    exponent = 0
    mantissa = value
    while mantissa >= 2#
        mantissa = mantissa / 2#
        exponent = exponent + 1
    end while
    while mantissa < 1# and exponent > -1022
        mantissa = mantissa * 2#
        exponent = exponent - 1
    end while
    mantissa = mantissa - 1#
    mantissaInt = 0#
    for i = 1 to 52
        mantissa = mantissa * 2#
        mantissaInt = (mantissaInt * 2#)
        if mantissa >= 1# then
            mantissaInt = mantissaInt + 1#
            mantissa = mantissa - 1#
        end if
    end for
    if mantissaInt = 4503599627370496# then
        mantissaInt = 0#
        exponent = exponent + 1
    end if
    exponent = exponent + 1023
    if exponent <= 0 then
        if mantissaInt = 0# and value <> 0 then
            exponent = 1
            mantissaInt = 0#
        else
            exponent = 0
            mantissaInt = 0#
        end if
    else if exponent >= 2047 then
        exponent = 2047
        mantissaInt = 0#
    end if
    highMantissa = __pb_fixNumber(mantissaInt / 4294967296#)
    lowMantissa = mantissaInt - (highMantissa * 4294967296#)

    parts.high = (signBit * 2147483648#) + (exponent * 1048576#) + highMantissa
    parts.low = lowMantissa
    return parts
end function

function __pb_uint64PartsToDouble(high as Double, low as Double) as Double
    unsignedHigh = high
    if unsignedHigh < 0 then
        unsignedHigh = unsignedHigh + 4294967296#
    end if
    signBit = 0
    if unsignedHigh >= 2147483648# then
        signBit = 1
        unsignedHigh = unsignedHigh - 2147483648#
    end if
    exponentField = __pb_fixNumber(unsignedHigh / 1048576#)
    mantissaHigh = unsignedHigh - (exponentField * 1048576#)
    mantissaComponent = (mantissaHigh * 4294967296#) + low

    if exponentField = 2047 then
        if mantissaComponent = 0 then
            if signBit = 1 then return -1e308 else return 1e308
        end if
        return 0#
    end if

    if exponentField = 0 then
        if mantissaComponent = 0 then return 0#
        significand = mantissaComponent
        power = -1074
    else
        significand = mantissaComponent + 4503599627370496#
        power = exponentField - 1075
    end if

    value = significand
    if power > 0 then
        for i = 1 to power
            value = value * 2#
        end for
    else if power < 0 then
        for i = 1 to 0 - power
            value = value / 2#
        end for
    end if

    if signBit = 1 then
        value = 0 - value
    end if
    return value
end function

function __pb_writeFloat64(target as Object, value as Dynamic) as Void
    if target = invalid then return
    parts = __pb_doubleToUint64Parts(__pb_toLong(value))
    lower = __pb_doubleToDecimalString(parts.low)
    upper = __pb_doubleToDecimalString(parts.high)
    __pb_writeFixedFromDecimal(target, lower, 4)
    __pb_writeFixedFromDecimal(target, upper, 4)
end function

function __pb_readFloat64(bytes as Object, startIndex as Integer) as Object
    raw = __pb_readFixed64Raw(bytes, startIndex)
    result = {}
    result.value = __pb_uint64PartsToDouble(raw.high, raw.low)
    result.nextIndex = raw.nextIndex
    return result
end function


function __pb_floatToUint32(value as Double) as Double
    if value = invalid then return 0
    if value = 0 then return 0#
    signBit = 0
    if value < 0 then
        signBit = 1
        value = 0 - value
    end if
    if value = 0 then return signBit * 2147483648#
    exponent = 0
    mantissa = value
    while mantissa >= 2#
        mantissa = mantissa / 2#
        exponent = exponent + 1
    end while
    while mantissa < 1# and exponent > -126
        mantissa = mantissa * 2#
        exponent = exponent - 1
    end while
    mantissa = mantissa - 1#
    mantissaInt = Int((mantissa * 8388608#) + 0.5#)
    if mantissaInt = 8388608 then
        mantissaInt = 0
        exponent = exponent + 1
    end if
    exponent = exponent + 127
    if exponent <= 0 then
        exponent = 0
        mantissaInt = 0
    else if exponent >= 255 then
        exponent = 255
        mantissaInt = 0
    end if
    return (signBit * 2147483648#) + (exponent * 8388608#) + mantissaInt
end function

function __pb_uint32ToFloat(bits as Double) as Double
    unsigned = bits
    if unsigned < 0 then
        unsigned = unsigned + 4294967296#
    end if
    signBit = 0
    if unsigned >= 2147483648# then
        signBit = 1
        unsigned = unsigned - 2147483648#
    end if
    exponent = __pb_fixNumber(unsigned / 8388608#)
    mantissa = unsigned - (exponent * 8388608#)
    value = 0#
    if exponent = 255 then
        if mantissa = 0 then
            if signBit = 1 then
                return -1e308
            else
                return 1e308
            end if
        end if
        return 0
    else if exponent = 0 then
        if mantissa <> 0 then
            fraction = mantissa / 8388608#
            value = fraction * (2 ^ (-126))
        end if
    else
        fraction = 1# + (mantissa / 8388608#)
        power = exponent - 127
        value = fraction * (2 ^ power)
    end if
    if signBit = 1 then
        value = 0 - value
    end if
    return value
end function

function __pb_writeFloat32(target as Object, value as Dynamic) as Void
    if target = invalid then return
    bits = __pb_floatToUint32(__pb_toLong(value))
    current = __pb_doubleToDecimalString(bits)
    for i = 0 to 3
        parts = __pb_decimalDivMod(current, 256)
        remainder = __pb_truncate(parts.remainder)
        target.Push(Int(remainder))
        current = parts.quotient
    end for
end function

function __pb_readFloat32(bytes as Object, startIndex as Integer) as Object
    fixed = __pb_readFixed32(bytes, startIndex)
    fixed.value = __pb_uint32ToFloat(fixed.value)
    return fixed
end function

function __pb_readString(bytes as Object, startIndex as Integer, length as Integer) as String
    text = ""
    for i = 0 to length - 1
        text = text + Chr(bytes[startIndex + i])
    end for
    return text
end function

function __pb_readBytes(bytes as Object, startIndex as Integer, length as Integer) as Object
    slice = __pb_createByteArray()
    for i = 0 to length - 1
        slice.Push(bytes[startIndex + i])
    end for
    return slice
end function

function __pb_sliceBytes(bytes as Object, startIndex as Integer, endIndex as Integer) as Object
    slice = __pb_createByteArray()
    if bytes = invalid then return slice
    count = bytes.Count()
    if endIndex > count then endIndex = count
    if startIndex < 0 then startIndex = 0
    for i = startIndex to endIndex - 1
        slice.Push(bytes[i])
    end for
    return slice
end function

function __pb_byteArrayToBase64(bytes as Object) as String
    if bytes = invalid then return ""
    return bytes.ToBase64String()
end function

function __pb_toLong(value as Dynamic) as Double
    if value = invalid then return 0
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then
        return Val(value)
    else if valueType = "Boolean" or valueType = "roBoolean" then
        if value = true then return 1 else return 0
    end if
    return value
end function

function __pb_toDecimalString(value as Double) as String
    if value < 0 then
        positive = __pb_doubleToDecimalString(0 - value)
        if positive = "0" then return "0"
        return "-" + positive
    end if
    return __pb_doubleToDecimalString(value)
end function

function __pb_skipUnknownField(bytes as Object, startIndex as Integer) as Object
    result = {}
    if bytes = invalid then
        result.nextIndex = startIndex
        return result
    end if
    tagResult = __pb_readVarint(bytes, startIndex)
    if tagResult = invalid then
        result.nextIndex = startIndex
        return result
    end if
    cursor = tagResult.nextIndex
    wireType = tagResult.value AND &h07
    if wireType = 0 then
        valueResult = __pb_readVarint(bytes, cursor)
        if valueResult = invalid then
            result.nextIndex = startIndex
            return result
        end if
        cursor = valueResult.nextIndex
    else if wireType = 1 then
        cursor = cursor + 8
    else if wireType = 2 then
        lengthResult = __pb_readVarint(bytes, cursor)
        if lengthResult = invalid then
            result.nextIndex = startIndex
            return result
        end if
        cursor = lengthResult.nextIndex + lengthResult.value
    else if wireType = 5 then
        cursor = cursor + 4
    else
        result.nextIndex = startIndex
        return result
    end if
    if cursor > bytes.Count() then cursor = bytes.Count()
    result.nextIndex = cursor
    result.raw = __pb_sliceBytes(bytes, startIndex, cursor)
    return result
end function

function __pb_storeUnknownField(message as Object, rawBytes as Object) as Void
    if message = invalid then return
    if GetInterface(message, "ifAssociativeArray") = invalid then return
    unknown = invalid
    if message.DoesExist("__pbUnknown") then
        unknown = message.__pbUnknown
    end if
    if unknown = invalid then
        unknown = CreateObject("roArray", 0, true)
        message.__pbUnknown = unknown
    end if
    base64 = __pb_byteArrayToBase64(rawBytes)
    unknown.Push(base64)
end function

function __pb_appendUnknownFields(target as Object, message as Object) as Void
    if target = invalid or message = invalid then return
    if GetInterface(message, "ifAssociativeArray") = invalid then return
    if message.DoesExist("__pbUnknown") = false then return
    unknown = message.__pbUnknown
    if GetInterface(unknown, "ifArray") = invalid then return
    for each entry in unknown
        chunk = __pb_fromBase64(entry)
        __pb_appendByteArray(target, chunk)
    end for
end function

function __pb_handleUnknownField(message as Object, bytes as Object, tagStart as Integer) as Integer
    skipResult = __pb_skipUnknownField(bytes, tagStart)
    if skipResult = invalid then return tagStart
    nextIndex = skipResult.nextIndex
    if nextIndex = invalid then return tagStart
    if nextIndex <= tagStart then return tagStart
    __pb_storeUnknownField(message, skipResult.raw)
    return nextIndex
end function

sub __pb_registerRuntime()
    globalAA = GetGlobalAA()
    if globalAA = invalid then return
    globalAA.__pb_createByteArray = __pb_createByteArray
    globalAA.__pb_writeVarint = __pb_writeVarint
    globalAA.__pb_writeVarint64 = __pb_writeVarint64
    globalAA.__pb_appendByteArray = __pb_appendByteArray
    globalAA.__pb_toBase64 = __pb_toBase64
    globalAA.__pb_fromBase64 = __pb_fromBase64
    globalAA.__pb_readVarint = __pb_readVarint
    globalAA.__pb_readVarint64 = __pb_readVarint64
    globalAA.__pb_readString = __pb_readString
    globalAA.__pb_readBytes = __pb_readBytes
    globalAA.__pb_byteArrayToBase64 = __pb_byteArrayToBase64
    globalAA.__pb_sliceBytes = __pb_sliceBytes
    globalAA.__pb_toLong = __pb_toLong
    globalAA.__pb_toDecimalString = __pb_toDecimalString
    globalAA.__pb_truncate = __pb_truncate
    globalAA.__pb_toSignedInt64String = __pb_toSignedInt64String
    globalAA.__pb_encodeZigZag32 = __pb_encodeZigZag32
    globalAA.__pb_decodeZigZag32 = __pb_decodeZigZag32
    globalAA.__pb_encodeZigZag64 = __pb_encodeZigZag64
    globalAA.__pb_decodeZigZag64 = __pb_decodeZigZag64
    globalAA.__pb_toUnsigned32 = __pb_toUnsigned32
    globalAA.__pb_toSigned32 = __pb_toSigned32
    globalAA.__pb_toSigned32FromString = __pb_toSigned32FromString
    globalAA.__pb_parseDecimalToDouble = __pb_parseDecimalToDouble
    globalAA.__pb_readFixed32 = __pb_readFixed32
    globalAA.__pb_readFixed64 = __pb_readFixed64
    globalAA.__pb_readFloat32 = __pb_readFloat32
    globalAA.__pb_readFloat64 = __pb_readFloat64
    globalAA.__pb_writeFloat32 = __pb_writeFloat32
    globalAA.__pb_writeFloat64 = __pb_writeFloat64
    globalAA.__pb_writeFixed32 = __pb_writeFixed32
    globalAA.__pb_writeFixed64 = __pb_writeFixed64
    globalAA.__pb_floatToUint32 = __pb_floatToUint32
    globalAA.__pb_uint32ToFloat = __pb_uint32ToFloat
    globalAA.__pb_skipUnknownField = __pb_skipUnknownField
    globalAA.__pb_storeUnknownField = __pb_storeUnknownField
    globalAA.__pb_appendUnknownFields = __pb_appendUnknownFields
    globalAA.__pb_handleUnknownField = __pb_handleUnknownField
end sub
